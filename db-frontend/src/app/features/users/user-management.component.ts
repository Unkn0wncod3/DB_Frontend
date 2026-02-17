import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { AuthRole } from '../../core/services/auth.service';
import { CreateUserPayload, UserAccount, UserService } from '../../core/services/user.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule],
  templateUrl: './user-management.component.html',
  styleUrl: './user-management.component.scss'
})
export class UserManagementComponent {
  private readonly userService = inject(UserService);
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);

  readonly users = signal<UserAccount[]>([]);
  readonly isLoading = signal(false);
  readonly isCreating = signal(false);
  readonly isDeleting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly pendingDeletion = signal<UserAccount | null>(null);
  readonly protectedUsername = 'core_admin_01';

  private readonly preferencesValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
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

  readonly createForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['user' as AuthRole, Validators.required],
    profile_picture_url: [''],
    preferences: ['', [this.preferencesValidator]]
  });

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const result = await firstValueFrom(this.userService.listUsers());
      this.users.set(result);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  async createUser(): Promise<void> {
    this.createForm.markAllAsTouched();
    if (this.createForm.invalid) {
      return;
    }

    const raw = this.createForm.getRawValue();
    let parsedPreferences: Record<string, unknown> | null = null;
    const preferencesValue = (raw.preferences ?? '').trim();
    if (preferencesValue) {
      try {
        parsedPreferences = JSON.parse(preferencesValue) as Record<string, unknown>;
      } catch {
        this.errorMessage.set(this.translate.instant('userManagement.form.preferencesInvalid'));
        return;
      }
    }

    const payload: CreateUserPayload = {
      username: raw.username.trim(),
      password: raw.password,
      role: raw.role,
      profile_picture_url: raw.profile_picture_url?.trim() ? raw.profile_picture_url.trim() : null,
      preferences: parsedPreferences
    };

    this.isCreating.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.userService.createUser(payload));
      this.successMessage.set(this.translate.instant('userManagement.status.created'));
      this.createForm.reset({
        username: '',
        password: '',
        role: 'user',
        profile_picture_url: '',
        preferences: ''
      });
      await this.refresh();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isCreating.set(false);
    }
  }

  requestDeletion(account: UserAccount): void {
    if (this.isProtectedAccount(account)) {
      return;
    }
    this.pendingDeletion.set(account);
    this.errorMessage.set(null);
  }

  async confirmDeletion(): Promise<void> {
    const account = this.pendingDeletion();
    if (!account) {
      return;
    }

    this.isDeleting.set(true);
    try {
      await firstValueFrom(this.userService.deleteUser(account.id));
      this.successMessage.set(this.translate.instant('userManagement.status.deleted', { username: account.username }));
      await this.refresh();
      this.pendingDeletion.set(null);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isDeleting.set(false);
    }
  }

  cancelDeletion(): void {
    this.pendingDeletion.set(null);
  }

  trackByUser(_index: number, user: UserAccount): string | number {
    return user.id;
  }

  roleLabel(role: AuthRole): string {
    return this.translate.instant(`userManagement.roles.${role}`);
  }

  isProtectedAccount(account: UserAccount): boolean {
    return account.username === this.protectedUsername;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('userManagement.status.genericError');
  }
}
