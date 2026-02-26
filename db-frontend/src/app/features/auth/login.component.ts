import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]]
  });

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.auth
      .login(this.form.getRawValue())
      .subscribe({
        next: () => {
          this.isSubmitting.set(false);
          const redirect = this.auth.consumeRedirectUrl() ?? '/';
          void this.router.navigateByUrl(redirect);
        },
        error: (err: unknown) => {
          this.isSubmitting.set(false);
          this.errorMessage.set(this.mapErrorToTranslation(err));
        }
      });
  }

  private mapErrorToTranslation(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (this.isAccountDisabled(error)) {
        return 'auth.errors.disabled';
      }
      if (error.status === 401) {
        return 'auth.errors.invalidCredentials';
      }
      if (error.status === 422) {
        return 'auth.errors.validation';
      }
    }
    return 'auth.errors.generic';
  }

  private isAccountDisabled(error: HttpErrorResponse): boolean {
    if (error.status !== 403 && error.status !== 423) {
      return false;
    }
    const message = this.extractErrorMessage(error).toLowerCase();
    const indicators = ['deactiv', 'disable', 'inactive', 'gesperrt', 'deaktiviert'];
    return indicators.some((indicator) => message.includes(indicator));
  }

  private extractErrorMessage(error: HttpErrorResponse): string {
    if (typeof error.error === 'string') {
      return error.error;
    }
    if (error.error && typeof error.error === 'object') {
      const body = error.error as Record<string, unknown>;
      const candidate = body['detail'] ?? body['message'] ?? body['error'];
      if (typeof candidate === 'string') {
        return candidate;
      }
    }
    return error.statusText ?? '';
  }
}
