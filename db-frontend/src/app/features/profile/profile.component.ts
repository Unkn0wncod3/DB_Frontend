import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { AccountService, UpdateAccountPayload } from '../../core/services/account.service';
import { AuthenticatedUser, AuthService } from '../../core/services/auth.service';

type PreferenceTheme = 'system' | 'light' | 'dark';

interface ProfileFormPreferences {
  theme: PreferenceTheme;
  language: string;
  email_notifications: boolean;
  push_notifications: boolean;
}

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

  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: [''],
    profile_picture_url: [''],
    theme: ['system' as PreferenceTheme],
    language: ['en'],
    email_notifications: [false],
    push_notifications: [false]
  });

  readonly profile = signal<AuthenticatedUser | null>(null);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  constructor() {
    void this.loadProfile();
  }

  preferencesDisplay(user: AuthenticatedUser | null) {
    return this.normalizePreferences(user?.preferences);
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

    const preferencesPayload = this.buildPreferencesFromForm(raw);
    const normalizedCurrentPreferences = this.normalizePreferences(currentProfile?.preferences);
    const currentPreferencesJson = JSON.stringify(normalizedCurrentPreferences);
    const newPreferencesJson = JSON.stringify(preferencesPayload);
    if (newPreferencesJson !== currentPreferencesJson) {
      payload.preferences = preferencesPayload;
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
    const normalizedPreferences = this.normalizePreferences(user.preferences);

    this.form.reset({
      username: user.username ?? '',
      password: '',
      profile_picture_url: user.profile_picture_url ?? '',
      theme: normalizedPreferences.theme,
      language: normalizedPreferences.language,
      email_notifications: normalizedPreferences.notifications.email,
      push_notifications: normalizedPreferences.notifications.push
    });
  }

  private buildPreferencesFromForm(formValue: Record<string, any>): Record<string, unknown> {
    return {
      theme: formValue['theme'] as PreferenceTheme,
      language: formValue['language'] as string,
      notifications: {
        email: !!formValue['email_notifications'],
        push: !!formValue['push_notifications']
      }
    };
  }

  private normalizePreferences(preferences: Record<string, unknown> | null | undefined): {
    theme: PreferenceTheme;
    language: string;
    notifications: { email: boolean; push: boolean };
  } {
    const defaultPrefs: ProfileFormPreferences = {
      theme: 'system',
      language: 'en',
      email_notifications: false,
      push_notifications: false
    };

    if (!preferences || typeof preferences !== 'object') {
      return { theme: defaultPrefs.theme, language: defaultPrefs.language, notifications: { email: false, push: false } };
    }

    const theme = (preferences['theme'] as PreferenceTheme) ?? defaultPrefs.theme;
    const language = (preferences['language'] as string) ?? defaultPrefs.language;
    const notifications = preferences['notifications'];
    const email = typeof notifications === 'object' && notifications !== null ? Boolean((notifications as Record<string, unknown>)['email']) : false;
    const push = typeof notifications === 'object' && notifications !== null ? Boolean((notifications as Record<string, unknown>)['push']) : false;

    return {
      theme,
      language,
      notifications: {
        email,
        push
      }
    };
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
