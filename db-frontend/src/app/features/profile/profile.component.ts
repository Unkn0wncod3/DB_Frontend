import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { AccountService, UpdateAccountPayload } from '../../core/services/account.service';
import { AuthenticatedUser, AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent {
  private readonly fb = inject(FormBuilder);
  private readonly account = inject(AccountService);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  private readonly jsonValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
    const value = (control.value ?? '').toString().trim();
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value);
      if (parsed !== null && typeof parsed === 'object') {
        return null;
      }
      return { invalidJson: true };
    } catch {
      return { invalidJson: true };
    }
  };

  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: [''],
    profile_picture_url: [''],
    preferences: ['', [this.jsonValidator]]
  });

  readonly profile = signal<AuthenticatedUser | null>(null);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  constructor() {
    void this.loadProfile();
  }

  async loadProfile(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      const result = await firstValueFrom(this.account.getProfile());
      this.profile.set(result);
      this.auth.updateUser(result);
      this.resetFormWithProfile(result);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
      const fallbackUser = this.auth.user();
      if (fallbackUser) {
        this.profile.set(fallbackUser);
        this.resetFormWithProfile(fallbackUser);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  async saveChanges(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSaving()) {
      return;
    }

    const raw = this.form.getRawValue();
    if (this.form.controls.preferences.invalid) {
      this.errorMessage.set(this.translate.instant('profile.errors.preferencesInvalid'));
      return;
    }

    const payload: UpdateAccountPayload = {};
    const currentProfile = this.profile();
    const trimmedUsername = raw.username.trim();

    if (trimmedUsername && trimmedUsername !== currentProfile?.username) {
      payload.username = trimmedUsername;
    }

    if (raw.password && raw.password.length > 0) {
      payload.password = raw.password;
    }

    const newProfilePicture = (raw.profile_picture_url ?? '').trim();
    const normalizedNewPicture = newProfilePicture ? newProfilePicture : null;
    const normalizedCurrentPicture = currentProfile?.profile_picture_url ?? null;
    if (normalizedNewPicture !== normalizedCurrentPicture) {
      payload.profile_picture_url = normalizedNewPicture;
    }

    let parsedPreferences: Record<string, unknown> | null = null;
    try {
      parsedPreferences = this.parsePreferences(raw.preferences ?? '');
    } catch {
      return;
    }
    const currentPreferencesJson = JSON.stringify(currentProfile?.preferences ?? null);
    const newPreferencesJson = JSON.stringify(parsedPreferences);
    if (newPreferencesJson !== currentPreferencesJson) {
      payload.preferences = parsedPreferences;
    }

    if (Object.keys(payload).length === 0) {
      this.successMessage.set(this.translate.instant('profile.status.noChanges'));
      this.form.patchValue({ password: '' });
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const updated = await firstValueFrom(this.account.updateProfile(payload));
      this.profile.set(updated);
      this.auth.updateUser(updated);
      this.resetFormWithProfile(updated);
      this.successMessage.set(this.translate.instant('profile.status.updated'));
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isSaving.set(false);
    }
  }

  clearPassword(): void {
    if (this.form.controls.password.value) {
      this.form.controls.password.setValue('');
    }
  }

  private resetFormWithProfile(user: AuthenticatedUser): void {
    this.form.reset({
      username: user.username ?? '',
      password: '',
      profile_picture_url: user.profile_picture_url ?? '',
      preferences: this.stringifyPreferences(user.preferences ?? null)
    });
  }

  private parsePreferences(value: string): Record<string, unknown> | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      this.errorMessage.set(this.translate.instant('profile.errors.preferencesInvalid'));
      throw new Error('Invalid preferences JSON');
    }
  }

  private stringifyPreferences(preferences: Record<string, unknown> | null): string {
    if (!preferences || typeof preferences !== 'object') {
      return '';
    }
    try {
      return JSON.stringify(preferences, null, 2);
    } catch {
      return '';
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        return this.translate.instant('profile.errors.unauthorized');
      }
      if (error.status === 422 || error.status === 400) {
        return this.translate.instant('profile.errors.validation');
      }
      if (error.status === 409) {
        return this.translate.instant('profile.errors.conflict');
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return this.translate.instant('profile.errors.generic');
  }
}
