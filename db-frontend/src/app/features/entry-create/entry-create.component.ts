import { JsonPipe, NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { EntryService } from '../../core/services/entry.service';
import { SchemaService } from '../../core/services/schema.service';
import { CreateEntryPayload, EntrySchema, SchemaField, VisibilityLevel } from '../../core/models/metadata.models';
import { getFieldOptions, humanizeKey, sortSchemaFields, supportsMultiple } from '../../core/utils/schema.utils';
import { ValueDropdownComponent } from '../../shared/components/value-dropdown/value-dropdown.component';

interface FormField {
  field: SchemaField;
  control: FormControl<unknown>;
}

@Component({
  selector: 'app-entry-create',
  standalone: true,
  imports: [NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, JsonPipe, ReactiveFormsModule, RouterLink, TranslateModule, ValueDropdownComponent],
  templateUrl: './entry-create.component.html',
  styleUrl: './entry-create.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryCreateComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly entryService = inject(EntryService);
  private readonly schemaService = inject(SchemaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  readonly auth = inject(AuthService);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly schema = signal<EntrySchema | null>(null);
  readonly formFields = signal<FormField[]>([]);
  readonly schemaLabel = computed(() => this.schema()?.name ?? humanizeKey(this.currentSchemaKey ?? 'entry'));

  readonly metaForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
    status: ['draft'],
    visibility_level: ['internal'],
    owner_id: [''],
    comment: ['']
  });

  form: FormGroup = this.fb.group({});
  private currentSchemaKey: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const schemaKey = params.get('schemaKey');
      if (!schemaKey || schemaKey === this.currentSchemaKey) {
        return;
      }
      this.currentSchemaKey = schemaKey;
      void this.loadSchema();
    });
  }

  backLink(): string[] | null {
    return this.currentSchemaKey ? ['/entries', this.currentSchemaKey] : null;
  }

  trackField(_index: number, item: FormField): string {
    return item.field.key;
  }

  fieldOptions(field: SchemaField) {
    return getFieldOptions(field);
  }

  isMultiple(field: SchemaField): boolean {
    return supportsMultiple(field) || field.data_type === 'multi_select';
  }

  async submit(): Promise<void> {
    if (!this.schema() || this.isSubmitting() || this.metaForm.invalid || this.form.invalid) {
      this.metaForm.markAllAsTouched();
      this.form.markAllAsTouched();
      return;
    }

    const payload = this.buildPayload(this.schema()!);
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const created = await firstValueFrom(this.entryService.createEntry(payload));
      await this.router.navigate(['/entries', this.currentSchemaKey, created.id]);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private async loadSchema(): Promise<void> {
    if (!this.currentSchemaKey) {
      return;
    }

    try {
      const schemas = await firstValueFrom(this.schemaService.loadSchemas());
      const schema = schemas.find((item) => item.key === this.currentSchemaKey) ?? null;
      this.schema.set(schema);

      if (!schema) {
        this.errorMessage.set(this.translate.instant('entryCreate.errors.unknownSchema', { schema: this.currentSchemaKey }));
        return;
      }

      const controls: Record<string, FormControl<unknown>> = {};
      const formFields = sortSchemaFields(schema.fields).map<FormField>((field) => {
        const validators = field.is_required ? [Validators.required] : [];
        const control = this.fb.control(this.defaultFieldValue(field), validators);
        controls[field.key] = control;
        return { field, control };
      });

      this.formFields.set(formFields);
      this.form = this.fb.group(controls);
      this.metaForm.patchValue({ title: schema.name, status: 'draft', visibility_level: 'internal' });
      this.errorMessage.set(null);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    }
  }

  private buildPayload(schema: EntrySchema): CreateEntryPayload {
    const data_json = this.formFields().reduce<Record<string, unknown>>((result, item) => {
      const value = this.normalizeFieldValue(item.field, item.control.value);
      if (value !== undefined) {
        result[item.field.key] = value;
      }
      return result;
    }, {});

    const meta = this.metaForm.getRawValue();
    return {
      schema_id: schema.id,
      title: meta.title.trim(),
      status: meta.status.trim() || null,
      visibility_level: meta.visibility_level as VisibilityLevel,
      owner_id: meta.owner_id.trim() || null,
      data_json
    };
  }

  private defaultFieldValue(field: SchemaField): unknown {
    if (field.default_value !== undefined && field.default_value !== null) {
      return field.default_value;
    }

    if (field.data_type === 'boolean') {
      return false;
    }

    if (field.data_type === 'multi_select' || supportsMultiple(field)) {
      return [];
    }

    return '';
  }

  private normalizeFieldValue(field: SchemaField, value: unknown): unknown {
    if (value === '' || value === null || value === undefined) {
      return field.is_required ? value : undefined;
    }

    switch (field.data_type) {
      case 'integer':
        return Number.parseInt(String(value), 10);
      case 'decimal':
        return Number.parseFloat(String(value));
      case 'boolean':
        return Boolean(value);
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'multi_select':
        return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
      case 'file':
      case 'reference':
        if (supportsMultiple(field)) {
          return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
        }
        return String(value).trim();
      default:
        return typeof value === 'string' ? value.trim() : value;
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('entryCreate.errors.loadFallback');
  }
}
