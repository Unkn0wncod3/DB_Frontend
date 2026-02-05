import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly createForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['user' as AuthRole, Validators.required]
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

    const payload = this.createForm.getRawValue() as CreateUserPayload;
    this.isCreating.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.userService.createUser(payload));
      this.successMessage.set(this.translate.instant('userManagement.status.created'));
      this.createForm.reset({ username: '', password: '', role: 'user' });
      await this.refresh();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isCreating.set(false);
    }
  }

  async deleteUser(account: UserAccount): Promise<void> {
    const confirmed = window.confirm(
      this.translate.instant('userManagement.actions.confirmDelete', { username: account.username })
    );
    if (!confirmed) {
      return;
    }

    try {
      await firstValueFrom(this.userService.deleteUser(account.id));
      this.successMessage.set(this.translate.instant('userManagement.status.deleted', { username: account.username }));
      await this.refresh();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    }
  }

  trackByUser(_index: number, user: UserAccount): string | number {
    return user.id;
  }

  roleLabel(role: AuthRole): string {
    return this.translate.instant(`userManagement.roles.${role}`);
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
