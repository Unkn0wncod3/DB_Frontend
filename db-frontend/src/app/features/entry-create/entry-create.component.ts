import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { EntryService } from '../../core/services/entry.service';
import { EntrySchema, EntrySchemaField, EntryFieldType, getEntrySchema } from './entry-create.schemas';

interface SchemaFieldControl {
  field: EntrySchemaField;
  control: FormControl<string | boolean | number | null>;
}

@Component({
  selector: 'app-entry-create',
  standalone: true,
  imports: [NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, ReactiveFormsModule, RouterLink, TranslateModule],
  templateUrl: './entry-create.component.html',
  styleUrl: './entry-create.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryCreateComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly entryService = inject(EntryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly schema = signal<EntrySchema | null>(null);
  readonly schemaFields = signal<SchemaFieldControl[]>([]);
  readonly typeLabel = signal('');
  readonly hasSchema = computed(() => this.schemaFields().length > 0);
  readonly rawPayloadControl = this.fb.nonNullable.control<string>('');

  form: FormGroup = this.fb.group({});
  private currentType: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const type = params.get('type');
      if (!type) {
        this.errorMessage.set(this.translate.instant('entryCreate.errors.missingType'));
        return;
      }

      if (type === this.currentType) {
        return;
      }

      this.currentType = type;
      this.loadSchema(type);
    });
  }

  trackField(_index: number, item: SchemaFieldControl): string {
    return item.field.key;
  }

  backLink(): string[] | null {
    if (!this.currentType) {
      return null;
    }

    return ['/entries', this.currentType];
  }

  async submit(): Promise<void> {
    if (!this.currentType || this.isSubmitting()) {
      return;
    }

    if (this.hasSchema() && this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = this.buildPayload();
    } catch (error) {
      this.errorMessage.set(this.translate.instant('entryCreate.errors.invalidPayload', {
        message: this.describeError(error)
      }));
      return;
    }

    if (Object.keys(payload).length === 0) {
      this.errorMessage.set(this.translate.instant('entryCreate.errors.emptyPayload'));
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const result = await firstValueFrom(this.entryService.createEntry(this.currentType, payload));
      this.successMessage.set(this.translate.instant('entryCreate.status.created'));

      const entryId = this.extractId(result);
      if (entryId) {
        await this.router.navigate(['/entries', this.currentType, entryId]);
        return;
      }

      this.form.reset();
      this.rawPayloadControl.reset('');
    } catch (error) {
      this.errorMessage.set(this.translate.instant('entryCreate.errors.createFailed', {
        message: this.describeError(error)
      }));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private loadSchema(type: string): void {
    const schema = getEntrySchema(type);
    this.schema.set(schema);
    this.typeLabel.set(schema?.title ?? this.humanize(type));
    this.rebuildForm(schema);
    this.successMessage.set(null);
    this.errorMessage.set(null);
  }

  private rebuildForm(schema: EntrySchema | null): void {
    const controls: Record<string, FormControl<string | boolean | number | null>> = {};
    const schemaControls: SchemaFieldControl[] = [];

    if (schema) {
      for (const field of schema.fields) {
        const control = this.createControl(field);
        controls[field.key] = control;
        schemaControls.push({ field, control });
      }
    }

    this.schemaFields.set(schemaControls);
    this.form = this.fb.group(controls);
  }

  private createControl(field: EntrySchemaField): FormControl<string | boolean | number | null> {
    const validators = field.required ? [Validators.required] : [];

    switch (field.type) {
      case 'boolean':
        return this.fb.nonNullable.control<boolean>(Boolean(field.defaultValue), validators);
      case 'number': {
        const defaultValue = typeof field.defaultValue === 'number' ? field.defaultValue : null;
        return this.fb.control<number | null>(defaultValue, validators);
      }
      case 'date':
        return this.fb.nonNullable.control<string>(typeof field.defaultValue === 'string' ? field.defaultValue : '', validators);
      default:
        return this.fb.nonNullable.control<string>(
          field.defaultValue != null ? String(field.defaultValue) : '',
          validators
        );
    }
  }

  private buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const { field, control } of this.schemaFields()) {
      const value = control.value;
      if (this.shouldSkipField(field, value)) {
        continue;
      }

      payload[field.key] = this.transformValue(field.type, value);
    }

    const rawPayload = this.rawPayloadControl.value.trim();
    if (rawPayload.length > 0) {
      try {
        const parsed = JSON.parse(rawPayload);
        Object.assign(payload, parsed);
      } catch {
        throw new Error(this.translate.instant('entryCreate.errors.invalidRawJson'));
      }
    }

    return payload;
  }

  private shouldSkipField(field: EntrySchemaField, value: string | number | boolean | null): boolean {
    if (field.required) {
      return false;
    }

    if (field.type === 'boolean') {
      return value === null;
    }

    if (field.type === 'number') {
      return value === null || value === undefined;
    }

    const stringValue = typeof value === 'string' ? value.trim() : '';
    return stringValue.length === 0;
  }

  private transformValue(fieldType: EntryFieldType, value: string | number | boolean | null): unknown {
    switch (fieldType) {
      case 'boolean':
        return Boolean(value);
      case 'number':
        if (typeof value === 'number') {
          return value;
        }
        return Number(value);
      case 'date':
        if (typeof value === 'string' && value.trim().length > 0) {
          const parsed = Date.parse(value);
          if (Number.isFinite(parsed)) {
            return new Date(parsed).toISOString();
          }
        }
        throw new Error(this.translate.instant('entryCreate.errors.invalidDate'));
      case 'json':
        if (typeof value !== 'string') {
          throw new Error(this.translate.instant('entryCreate.errors.invalidJsonField'));
        }
        try {
          return JSON.parse(value);
        } catch {
          throw new Error(this.translate.instant('entryCreate.errors.invalidJsonField'));
        }
      default:
        if (typeof value === 'string') {
          return value.trim();
        }
        if (value == null) {
          return '';
        }
        return value;
    }
  }

  private extractId(record: unknown): string | null {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return null;
    }

    const candidate = record as Record<string, unknown>;
    const idValue = candidate['id'] ?? candidate['_id'];

    if (typeof idValue === 'string' && idValue.trim().length > 0) {
      return idValue.trim();
    }

    if (typeof idValue === 'number') {
      return idValue.toString();
    }

    return null;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }

    return this.translate.instant('entryCreate.errors.unknown');
  }

  private humanize(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
