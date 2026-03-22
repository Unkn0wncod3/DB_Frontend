import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { SchemaService } from '../../core/services/schema.service';
import { SchemaEditorFormComponent, SchemaEditorSubmitPayload } from '../schema-editor-form/schema-editor-form.component';

@Component({
  selector: 'app-schema-create',
  standalone: true,
  imports: [RouterLink, TranslateModule, SchemaEditorFormComponent],
  templateUrl: './schema-create.component.html',
  styleUrl: './schema-create.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SchemaCreateComponent {
  private readonly router = inject(Router);
  private readonly schemaService = inject(SchemaService);
  private readonly translate = inject(TranslateService);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async submit(payload: SchemaEditorSubmitPayload): Promise<void> {
    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      const created = await firstValueFrom(
        this.schemaService.createSchemaWithFields(payload.schema, payload.fields)
      );

      await this.router.navigate(['/entries', created.key]);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 409) {
        const schemaKey = this.extractConflictingSchemaKey(error);
        return this.translate.instant('schemaCreate.errors.keyConflict', { key: schemaKey });
      }

      const detail = this.extractErrorDetail(error);
      if (detail) {
        return this.translate.instant('schemaCreate.errors.generic', { message: detail });
      }
    }

    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('schemaCreate.errors.loadFallback');
  }

  private extractConflictingSchemaKey(error: HttpErrorResponse): string {
    const payload = error.error;
    const detail = this.extractErrorDetail(error);
    const fromPayload =
      typeof payload === 'object' && payload !== null && 'key' in payload ? String((payload as { key?: unknown }).key ?? '') : '';

    return fromPayload || this.extractKeyFromText(detail) || 'schema_key';
  }

  private extractErrorDetail(error: HttpErrorResponse): string {
    const payload = error.error;
    if (typeof payload === 'string') {
      return payload;
    }
    if (typeof payload === 'object' && payload !== null) {
      if ('detail' in payload && payload.detail != null) {
        return String((payload as { detail?: unknown }).detail);
      }
      if ('message' in payload && payload.message != null) {
        return String((payload as { message?: unknown }).message);
      }
    }
    return error.message ?? '';
  }

  private extractKeyFromText(value: string): string | null {
    const match = value.match(/["']?([a-z0-9_]+)["']?/i);
    return match?.[1] ?? null;
  }
}
