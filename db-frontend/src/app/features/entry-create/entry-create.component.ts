import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { EntryService } from '../../core/services/entry.service';
import { SchemaService } from '../../core/services/schema.service';
import { CreateEntryPayload, EntrySchema, FieldDataType, SchemaField, VisibilityLevel } from '../../core/models/metadata.models';
import {
  buildCreateSchemaFieldPayload,
  buildUpdateSchemaFieldPayload,
  createSchemaFieldDialogForm,
  normalizeSchemaFieldKey,
  patchSchemaFieldDialogForm,
  resetSchemaFieldDialogForm,
  shouldShowSchemaFieldOptionsInput
} from '../../core/utils/schema-field-dialog.utils';
import { SchemaFieldCardComponent } from '../../shared/components/schema-field-card/schema-field-card.component';
import { getFieldOptions, humanizeKey, sortSchemaFields, supportsMultiple } from '../../core/utils/schema.utils';

interface FormField {
  field: SchemaField;
  control: FormControl<unknown>;
}

@Component({
  selector: 'app-entry-create',
  standalone: true,
  imports: [NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, ReactiveFormsModule, RouterLink, TranslateModule, SchemaFieldCardComponent],
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
  readonly isCreatingField = signal(false);
  readonly isDeletingField = signal(false);
  readonly isFieldDialogOpen = signal(false);
  readonly createFieldError = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly schema = signal<EntrySchema | null>(null);
  readonly formFields = signal<FormField[]>([]);
  readonly schemaLabel = computed(() => this.schema()?.name ?? humanizeKey(this.currentSchemaKey ?? 'entry'));
  readonly editingField = signal<SchemaField | null>(null);
  readonly visibilityLevels: VisibilityLevel[] = ['public', 'internal', 'restricted', 'private'];
  readonly defaultStatusOptions = ['active', 'draft', 'review', 'inactive', 'archived'];
  readonly fieldTypes: FieldDataType[] = ['text', 'long_text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'email', 'url', 'select', 'multi_select', 'reference', 'file', 'json'];
  readonly statusOptions = computed(() => {
    const current = this.metaForm.controls.status.getRawValue().trim();
    return Array.from(new Set([current, ...this.defaultStatusOptions].filter((value) => value.length > 0)));
  });

  readonly metaForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
    status: ['active'],
    visibility_level: ['internal' as VisibilityLevel],
    owner_id: [''],
    comment: ['']
  });
  readonly createFieldForm = createSchemaFieldDialogForm(this.fb);

  form: FormGroup = this.fb.group({});
  private currentSchemaKey: string | null = null;
  private createFieldKeyAutoSync = true;

  constructor() {
    this.createFieldForm.controls.label.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      if (!this.createFieldKeyAutoSync || this.editingField()) {
        return;
      }
      this.createFieldForm.controls.key.setValue(this.toFieldKey(value), { emitEvent: false });
    });

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

  metaStatusLabel(value: string): string {
    return humanizeKey(value);
  }

  fieldLabel(field: SchemaField): string {
    return field.label?.trim() || humanizeKey(field.key);
  }

  fieldHint(field: SchemaField): string | null {
    return field.description?.trim() || null;
  }

  fieldControlId(field: SchemaField): string {
    return `create-field-${field.key}`;
  }

  isWideField(field: SchemaField): boolean {
    return field.data_type === 'long_text' || field.data_type === 'json';
  }

  isBooleanField(field: SchemaField): boolean {
    return field.data_type === 'boolean';
  }

  openFieldDialog(): void {
    if (!this.schema() || !this.auth.canManageSchemas()) {
      return;
    }
    this.editingField.set(null);
    this.createFieldKeyAutoSync = true;
    resetSchemaFieldDialogForm(this.createFieldForm);
    this.createFieldError.set(null);
    this.isFieldDialogOpen.set(true);
  }

  editField(field: SchemaField): void {
    if (!this.auth.canManageSchemas()) {
      return;
    }
    this.editingField.set(field);
    this.createFieldKeyAutoSync = false;
    patchSchemaFieldDialogForm(this.createFieldForm, field);
    this.createFieldError.set(null);
    this.isFieldDialogOpen.set(true);
  }

  closeFieldDialog(): void {
    this.isFieldDialogOpen.set(false);
    this.editingField.set(null);
    this.createFieldError.set(null);
  }

  isCreateFieldKeyAuto(): boolean {
    return this.createFieldKeyAutoSync && !this.editingField();
  }

  enableManualCreateFieldKey(): void {
    this.createFieldKeyAutoSync = false;
    this.createFieldError.set(null);
  }

  onCreateFieldKeyInput(): void {
    const currentValue = this.createFieldForm.controls.key.value.trim();
    const generatedValue = this.toFieldKey(this.createFieldForm.controls.label.value);
    this.createFieldKeyAutoSync = currentValue.length === 0 || currentValue === generatedValue;
    this.createFieldError.set(null);
  }

  async createField(): Promise<void> {
    const schema = this.schema();
    if (!schema || this.createFieldForm.invalid || this.isCreatingField()) {
      return;
    }

    const raw = this.createFieldForm.getRawValue();
    const label = raw.label.trim();
    const editingField = this.editingField();
    const normalizedKey = raw.key.trim() || this.toFieldKey(label);

    if (!normalizedKey) {
      this.createFieldError.set(this.translate.instant('schemaFields.errors.keyGenerateFailed'));
      this.createFieldKeyAutoSync = false;
      return;
    }

    if ((this.schema()?.fields ?? []).some((field) => field.key === normalizedKey && String(field.id) !== String(editingField?.id ?? ''))) {
      this.createFieldError.set(this.translate.instant('schemaFields.errors.keyConflict', { key: normalizedKey }));
      this.createFieldForm.controls.key.setValue(normalizedKey);
      this.createFieldKeyAutoSync = false;
      return;
    }

    this.isCreatingField.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      if (editingField) {
        await firstValueFrom(
          this.schemaService.updateField(schema.id, editingField.id, buildUpdateSchemaFieldPayload(raw, normalizedKey))
        );
      } else {
        await firstValueFrom(
          this.schemaService.createField(
            schema.id,
            buildCreateSchemaFieldPayload(raw, normalizedKey, (schema.fields?.length ?? 0) * 10 + 10)
          )
        );
      }

      this.isFieldDialogOpen.set(false);
      await this.loadSchema();
      this.successMessage.set(
        this.translate.instant(editingField ? 'schemaFields.status.updated' : 'schemaFields.status.created', { value: label })
      );
    } catch (error) {
      const message = this.describeError(error);
      const normalizedMessage = message.toLowerCase();
      this.createFieldError.set(
        normalizedMessage.includes('key') && (normalizedMessage.includes('exist') || normalizedMessage.includes('duplicate') || normalizedMessage.includes('unique'))
          ? this.translate.instant('schemaFields.errors.keyConflict', { key: normalizedKey })
          : this.translate.instant('schemaFields.errors.keyGeneric', { message })
      );
      this.createFieldForm.controls.key.setValue(normalizedKey);
      this.createFieldKeyAutoSync = false;
    } finally {
      this.isCreatingField.set(false);
    }
  }

  async deleteField(field: SchemaField): Promise<void> {
    const schema = this.schema();
    if (!schema || !this.auth.canManageSchemas() || this.isDeletingField()) {
      return;
    }

    this.isDeletingField.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await firstValueFrom(this.schemaService.deleteField(schema.id, field.id));
      if (this.editingField()?.id === field.id) {
        this.closeFieldDialog();
      }
      await this.loadSchema();
      this.successMessage.set(this.translate.instant('schemaFields.status.deleted', { value: field.label || field.key }));
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isDeletingField.set(false);
    }
  }

  async deleteEditingField(): Promise<void> {
    const field = this.editingField();
    if (!field) {
      return;
    }

    this.isFieldDialogOpen.set(false);
    await this.deleteField(field);
  }

  fieldDialogTitle(): string {
    return this.editingField()
      ? this.translate.instant('schemaFields.dialog.editTitle')
      : this.translate.instant('schemaFields.dialog.title');
  }

  fieldDialogSubtitle(): string {
    return this.editingField()
      ? this.translate.instant('schemaFields.dialog.editSubtitle')
      : this.translate.instant('schemaFields.dialog.subtitle');
  }

  fieldButtonLabel(): string {
    return this.editingField()
      ? this.translate.instant('schemaFields.actions.save')
      : this.translate.instant('schemaFields.actions.create');
  }

  shouldShowCreateFieldOptionsInput(): boolean {
    return shouldShowSchemaFieldOptionsInput(this.createFieldForm.controls.data_type.getRawValue());
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
    this.successMessage.set(null);

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
      const currentUser = this.auth.user();
      this.metaForm.patchValue({
        title: schema.name,
        status: 'active',
        visibility_level: 'internal',
        owner_id: currentUser?.id != null ? String(currentUser.id) : ''
      });
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
      return this.prepareFieldControlValue(field.default_value, field);
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
        return this.toBoolean(value);
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'multi_select':
        return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
      case 'file':
      case 'reference':
        if (supportsMultiple(field)) {
          return (Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean))
            .map((item) => this.normalizeIdentifierValue(item))
            .filter((item) => item !== undefined);
        }
        return this.normalizeIdentifierValue(value, field.is_required);
      default:
        return typeof value === 'string' ? value.trim() : value;
    }
  }

  private prepareFieldControlValue(value: unknown, field: SchemaField): unknown {
    if (field.data_type === 'json') {
      return this.stringifyJson(value);
    }

    if (field.data_type === 'date') {
      return this.toDateInputValue(value);
    }

    if (field.data_type === 'datetime') {
      return this.toDateTimeInputValue(value);
    }

    if (field.data_type === 'boolean') {
      return this.toBoolean(value);
    }

    if (field.data_type === 'multi_select' || ((field.data_type === 'reference' || field.data_type === 'file') && supportsMultiple(field))) {
      return this.toArrayValue(value);
    }

    return value;
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

  private toFieldKey(label: string): string {
    return normalizeSchemaFieldKey(label);
  }

  private toDateInputValue(value: unknown): string {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toISOString().slice(0, 10);
  }

  private toDateTimeInputValue(value: unknown): string {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    const year = parsed.getFullYear();
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const day = `${parsed.getDate()}`.padStart(2, '0');
    const hours = `${parsed.getHours()}`.padStart(2, '0');
    const minutes = `${parsed.getMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private toArrayValue(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return value == null ? [] : [String(value)];
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
  }

  private stringifyJson(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private normalizeIdentifierValue(value: unknown, isRequired = false): string | number | undefined {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return isRequired ? '' : undefined;
    }

    return /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : normalized;
  }
}
