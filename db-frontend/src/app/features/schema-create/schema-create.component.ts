import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('schemaCreate.errors.loadFallback');
  }
}
