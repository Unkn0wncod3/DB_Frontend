import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { SchemaService } from '../../core/services/schema.service';

@Component({
  selector: 'app-schema-create',
  standalone: true,
  imports: [NgIf, ReactiveFormsModule, RouterLink, TranslateModule],
  templateUrl: './schema-create.component.html',
  styleUrl: './schema-create.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SchemaCreateComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly schemaService = inject(SchemaService);
  private readonly translate = inject(TranslateService);
  readonly auth = inject(AuthService);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    key: ['', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
    name: ['', Validators.required],
    description: [''],
    icon: [''],
    is_active: [true]
  });

  async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const raw = this.form.getRawValue();
    try {
      const created = await firstValueFrom(
        this.schemaService.createSchema({
          key: raw.key.trim(),
          name: raw.name.trim(),
          description: raw.description.trim() || null,
          icon: raw.icon.trim() || null,
          is_active: raw.is_active
        })
      );

      await this.router.navigate(['/entries', created.key]);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('schemaCreate.errors.loadFallback');
  }
}
