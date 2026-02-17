import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthRole, AuthenticatedUser, AuthService } from '../../core/services/auth.service';
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
  readonly viewingPreferences = signal<UserAccount | null>(null);
  readonly roleUpdatingId = signal<string | number | null>(null);
  readonly currentUser = signal<AuthenticatedUser | null>(null);

  readonly createForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required]],
    role: ['user' as AuthRole, Validators.required],
    profile_picture_url: ['']
  });

  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.currentUser.set(this.auth.user());
    this.auth
      .userChanges()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => this.currentUser.set(user));
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
    const trimmedUsername = raw.username.trim();
    const payload: CreateUserPayload = {
      username: trimmedUsername,
      password: raw.password,
      role: raw.role
    };

    const trimmedPicture = raw.profile_picture_url?.trim();
    if (trimmedPicture) {
      payload.profile_picture_url = trimmedPicture;
    }

    this.isCreating.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.userService.createUser(payload));
      this.successMessage.set(this.translate.instant('userManagement.status.created'));
      this.createForm.reset({
        username: '',
        password: '',
        role: 'user',
        profile_picture_url: ''
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

  openPreferences(user: UserAccount): void {
    this.viewingPreferences.set(user);
  }

  closePreferences(): void {
    this.viewingPreferences.set(null);
  }

  preferencesSummary(user: UserAccount | null): { theme: string; language: string; notifications: { email: boolean; push: boolean } } {
    const defaults = { theme: 'system', language: 'en', notifications: { email: false, push: false } };
    if (!user?.preferences || typeof user.preferences !== 'object') {
      return defaults;
    }
    const prefs = user.preferences as Record<string, unknown>;
    const notifications = prefs['notifications'];
    return {
      theme: (prefs['theme'] as string) ?? defaults.theme,
      language: (prefs['language'] as string) ?? defaults.language,
      notifications: {
        email: typeof notifications === 'object' && notifications !== null ? Boolean((notifications as Record<string, unknown>)['email']) : false,
        push: typeof notifications === 'object' && notifications !== null ? Boolean((notifications as Record<string, unknown>)['push']) : false
      }
    };
  }

  async changeRole(user: UserAccount, newRole: AuthRole): Promise<void> {
    if (newRole === user.role) {
      return;
    }
    if (!this.canEditRoleTarget(user, newRole)) {
      this.errorMessage.set(this.translate.instant('userManagement.status.roleRestricted'));
      return;
    }

    this.roleUpdatingId.set(user.id);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.userService.updateUser(user.id, { role: newRole }));
      this.successMessage.set(this.translate.instant('userManagement.status.roleUpdated', { username: user.username }));
      await this.refresh();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.roleUpdatingId.set(null);
    }
  }

  onRoleChange(user: UserAccount, value: string): void {
    const newRole = value as AuthRole;
    void this.changeRole(user, newRole);
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

  isCurrentUser(account: UserAccount): boolean {
    return this.currentUser()?.id === account.id;
  }

  canEditUserRole(account: UserAccount): boolean {
    if (this.isProtectedAccount(account)) {
      return false;
    }
    if (account.role === 'admin' && !this.isCoreAdminUser()) {
      return false;
    }
    return true;
  }

  canSelectRoleOption(option: AuthRole): boolean {
    if (option === 'admin' && !this.isCoreAdminUser()) {
      return false;
    }
    return true;
  }

  private canEditRoleTarget(account: UserAccount, targetRole: AuthRole): boolean {
    if (this.isProtectedAccount(account)) {
      return false;
    }
    if (this.isCurrentUser(account) && account.role === targetRole) {
      return false;
    }
    if (!this.isCoreAdminUser() && (account.role === 'admin' || targetRole === 'admin')) {
      return false;
    }
    return true;
  }

  private isCoreAdminUser(): boolean {
    return this.currentUser()?.username === this.protectedUsername;
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
