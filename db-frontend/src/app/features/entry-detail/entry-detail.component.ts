import { DatePipe, NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { EntryService } from '../../core/services/entry.service';
import { SchemaService } from '../../core/services/schema.service';
import {
  AttachmentRecord,
  EntryAccessMap,
  EntryBundle,
  EntryHistoryRecord,
  EntryPermissionRecord,
  EntryRecord,
  EntryRelationRecord,
  EntrySchema,
  FieldDataType,
  SchemaField,
  VisibilityLevel
} from '../../core/models/metadata.models';
import {
  formatFieldValue,
  getFieldOptions,
  getFieldValue,
  getReferenceSchemaKey,
  humanizeKey,
  resolveEntryTitle,
  sortSchemaFields,
  supportsMultiple
} from '../../core/utils/schema.utils';

interface DetailField {
  field: SchemaField;
  control: FormControl<unknown>;
}

@Component({
  selector: 'app-entry-detail',
  standalone: true,
  imports: [NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, ReactiveFormsModule, RouterModule, DatePipe, TranslateModule],
  templateUrl: './entry-detail.component.html',
  styleUrls: ['./entry-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly entryService = inject(EntryService);
  private readonly schemaService = inject(SchemaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  readonly auth = inject(AuthService);

  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly isCreatingField = signal(false);
  readonly isDeletingField = signal(false);
  readonly isFieldDialogOpen = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly entry = signal<EntryRecord | null>(null);
  readonly schema = signal<EntrySchema | null>(null);
  readonly access = signal<EntryAccessMap>(this.emptyAccess());
  readonly history = signal<EntryHistoryRecord[]>([]);
  readonly relations = signal<EntryRelationRecord[]>([]);
  readonly attachments = signal<AttachmentRecord[]>([]);
  readonly permissions = signal<EntryPermissionRecord[]>([]);
  readonly fields = signal<DetailField[]>([]);
  readonly referenceTitles = signal<Record<string, string>>({});
  readonly visibilityLevels: VisibilityLevel[] = ['public', 'internal', 'restricted', 'private'];
  readonly defaultStatusOptions = ['draft', 'review', 'active', 'inactive', 'archived'];
  readonly fieldTypes: FieldDataType[] = ['text', 'long_text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'email', 'url', 'select', 'multi_select', 'reference', 'file', 'json'];
  readonly editingField = signal<SchemaField | null>(null);

  readonly entryTitle = computed(() => {
    const entry = this.entry();
    return entry ? resolveEntryTitle(entry, this.schema()) : this.translate.instant('entryDetail.labels.unknownId');
  });
  readonly canEdit = computed(() => this.access().manage || this.access().edit);
  readonly canDelete = computed(() => this.access().manage || this.access().delete);
  readonly schemaFieldsTitle = computed(() => {
    const schema = this.schema();
    return schema ? this.translate.instant('entryDetail.sections.schemaFieldsNamed', { schema: schema.name }) : '';
  });
  readonly statusOptions = computed(() => {
    const current = this.metaForm.controls.status.getRawValue().trim();
    return Array.from(new Set([current, ...this.defaultStatusOptions].filter((value) => value.length > 0)));
  });

  readonly metaForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
    status: [''],
    visibility_level: ['internal' as VisibilityLevel],
    owner_id: [''],
    comment: ['']
  });
  readonly createFieldForm = this.fb.nonNullable.group({
    label: ['', [Validators.required]],
    key: [''],
    description: [''],
    data_type: ['text' as FieldDataType, [Validators.required]],
    is_required: [false]
  });

  form: FormGroup = this.fb.group({});
  private currentSchemaKey: string | null = null;
  private currentEntryId: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const schemaKey = params.get('schemaKey');
      const entryId = params.get('id');
      if (!schemaKey || !entryId) {
        this.errorMessage.set(this.translate.instant('entryDetail.errors.missingParams'));
        return;
      }
      if (schemaKey === this.currentSchemaKey && entryId === this.currentEntryId) {
        return;
      }
      this.currentSchemaKey = schemaKey;
      this.currentEntryId = entryId;
      void this.load();
    });
  }

  async refresh(): Promise<void> {
    await this.load();
  }

  async save(): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.canEdit() || this.form.invalid || this.metaForm.invalid) {
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await firstValueFrom(
        this.entryService.updateEntry(entry.id, {
          title: this.metaForm.getRawValue().title.trim(),
          status: this.access().edit_status || this.access().manage ? this.metaForm.getRawValue().status.trim() || null : undefined,
          visibility_level:
            this.access().edit_visibility || this.access().manage
              ? (this.metaForm.getRawValue().visibility_level as VisibilityLevel)
              : undefined,
          owner_id: this.metaForm.getRawValue().owner_id.trim() || null,
          comment: this.metaForm.getRawValue().comment.trim() || null,
          data_json: this.buildDataJson()
        })
      );
      await this.load();
      this.successMessage.set(this.translate.instant('entryDetail.status.saved'));
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'save'));
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteEntry(): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.canDelete()) {
      return;
    }

    try {
      await firstValueFrom(this.entryService.softDeleteEntry(entry.id, this.metaForm.getRawValue().comment.trim()));
      await this.router.navigate(['/entries', this.schema()?.key ?? this.currentSchemaKey ?? '']);
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'delete'));
    }
  }

  openFieldDialog(): void {
    if (!this.schema() || !this.auth.canManageSchemas()) {
      return;
    }
    this.editingField.set(null);
    this.createFieldForm.reset({ label: '', key: '', description: '', data_type: 'text', is_required: false });
    this.isFieldDialogOpen.set(true);
  }

  editField(field: SchemaField): void {
    if (!this.auth.canManageSchemas()) {
      return;
    }
    this.editingField.set(field);
    this.createFieldForm.reset({
      label: field.label ?? '',
      key: field.key ?? '',
      description: field.description ?? '',
      data_type: field.data_type,
      is_required: field.is_required
    });
    this.isFieldDialogOpen.set(true);
  }

  closeFieldDialog(): void {
    this.isFieldDialogOpen.set(false);
    this.editingField.set(null);
  }

  async createField(): Promise<void> {
    const schema = this.schema();
    if (!schema || this.createFieldForm.invalid || this.isCreatingField()) {
      return;
    }

    this.isCreatingField.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    const raw = this.createFieldForm.getRawValue();
    const label = raw.label.trim();
    const editingField = this.editingField();

    try {
      if (editingField) {
        await firstValueFrom(
          this.schemaService.updateField(schema.id, editingField.id, {
            key: raw.key.trim(),
            label,
            description: raw.description.trim() || null,
            data_type: raw.data_type,
            is_required: raw.is_required
          })
        );
      } else {
        await firstValueFrom(
          this.schemaService.createField(schema.id, {
            key: raw.key.trim() || this.toFieldKey(label),
            label,
            description: raw.description.trim() || null,
            data_type: raw.data_type,
            is_required: raw.is_required,
            is_unique: false,
            sort_order: (schema.fields?.length ?? 0) * 10 + 10,
            is_active: true,
            validation_json: {},
            settings_json: {}
          })
        );
      }
      this.isFieldDialogOpen.set(false);
      await this.load();
      this.successMessage.set(
        this.translate.instant(editingField ? 'schemaFields.status.updated' : 'schemaFields.status.created', { value: label })
      );
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'load'));
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
      await this.load();
      this.successMessage.set(this.translate.instant('schemaFields.status.deleted', { value: field.label || field.key }));
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'load'));
    } finally {
      this.isDeletingField.set(false);
    }
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

  trackField(_index: number, item: DetailField): string {
    return item.field.key;
  }

  trackRelation(_index: number, item: EntryRelationRecord): string | number {
    return item.id;
  }

  trackAttachment(_index: number, item: AttachmentRecord): string | number {
    return item.id;
  }

  trackPermission(_index: number, item: EntryPermissionRecord): string | number {
    return item.id;
  }

  trackHistory(_index: number, item: EntryHistoryRecord): string | number {
    return item.id;
  }

  fieldOptions(field: SchemaField) {
    return getFieldOptions(field);
  }

  fieldLabel(field: SchemaField): string {
    return field.label?.trim() || humanizeKey(field.key);
  }

  metaStatusLabel(value: string): string {
    return humanizeKey(value);
  }

  fieldHint(field: SchemaField): string | null {
    const description = field.description?.trim();
    return description ? description : null;
  }

  fieldControlId(field: SchemaField): string {
    return `entry-field-${field.key}`;
  }

  isWideField(field: SchemaField): boolean {
    return field.data_type === 'long_text' || field.data_type === 'json' || supportsMultiple(field);
  }

  isBooleanField(field: SchemaField): boolean {
    return field.data_type === 'boolean';
  }

  summaryValue(field: SchemaField): string {
    const detailField = this.fields().find((item) => item.field.key === field.key);
    if (!detailField) {
      return '';
    }

    const displayValue = this.coerceDisplayValue(field, detailField.control.value);
    if (field.data_type === 'reference' && !supportsMultiple(field) && displayValue != null) {
      const key = String(displayValue);
      return this.referenceTitles()[key] ?? key;
    }

    if ((field.data_type === 'reference' || field.data_type === 'file') && supportsMultiple(field) && Array.isArray(displayValue)) {
      return displayValue.map((item) => String(item)).join(', ');
    }

    if (field.data_type === 'date') {
      return this.formatReadableDate(displayValue, false);
    }

    if (field.data_type === 'datetime') {
      return this.formatReadableDate(displayValue, true);
    }

    return formatFieldValue(displayValue, field);
  }

  renderHistoryDiff(record: EntryHistoryRecord): string[] {
    const before = record.old_data_json ?? {};
    const after = record.new_data_json ?? {};
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const diffs = keys
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => {
        const label = this.labelForHistoryKey(key);
        const previous = formatFieldValue(before[key]);
        const next = formatFieldValue(after[key]);
        return `${label}: ${previous || '-'} -> ${next || '-'}`;
      });

    if (record.old_visibility_level !== record.new_visibility_level) {
      diffs.push(
        `${this.translate.instant('entryDetail.history.visibility')}: ${record.old_visibility_level ?? '-'} -> ${
          record.new_visibility_level ?? '-'
        }`
      );
    }

    return diffs;
  }

  referenceLink(field: SchemaField, value: unknown): string[] | null {
    const schemaKey = getReferenceSchemaKey(field);
    if (!schemaKey || (typeof value !== 'string' && typeof value !== 'number')) {
      return null;
    }
    return ['/entries', schemaKey, String(value)];
  }

  referenceLabel(value: unknown): string {
    const id = String(value ?? '').trim();
    return this.referenceTitles()[id] ?? id;
  }

  attachmentUrl(attachment: AttachmentRecord): string | null {
    const candidate = attachment.external_url ?? attachment.stored_path ?? null;
    return candidate && candidate.trim().length > 0 ? candidate : null;
  }

  relationMetadata(relation: EntryRelationRecord): string {
    return relation.metadata_json ? JSON.stringify(relation.metadata_json, null, 2) : '';
  }

  private async load(): Promise<void> {
    if (!this.currentEntryId) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const bundle = await firstValueFrom(this.entryService.getEntryBundle(this.currentEntryId));
      this.applyBundle(bundle);
      await this.loadReferenceTitles(bundle.entry, bundle.schema);
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'load'));
    } finally {
      this.isLoading.set(false);
    }
  }

  private applyBundle(bundle: EntryBundle): void {
    this.entry.set(bundle.entry);
    this.schema.set(bundle.schema);
    this.access.set({ ...this.emptyAccess(), ...(bundle.access ?? this.emptyAccess()) });
    this.history.set(bundle.history ?? []);
    this.relations.set(bundle.relations ?? []);
    this.attachments.set(bundle.attachments ?? []);
    this.permissions.set(bundle.permissions ?? []);
    this.rebuildForms(bundle.entry, bundle.schema);
  }

  private rebuildForms(entry: EntryRecord, schema: EntrySchema | null): void {
    this.metaForm.reset(
      {
        title: entry.title ?? '',
        status: entry.status ?? '',
        visibility_level: entry.visibility_level ?? 'internal',
        owner_id: entry.owner_id != null ? String(entry.owner_id) : '',
        comment: ''
      },
      { emitEvent: false }
    );

    const controls: Record<string, FormControl<unknown>> = {};
    const fields = sortSchemaFields(schema?.fields ?? []).map<DetailField>((field) => {
      const validators = field.is_required ? [Validators.required] : [];
      const control = this.fb.control(this.prepareFieldControlValue(entry, field), validators);
      controls[field.key] = control;
      return { field, control };
    });

    this.fields.set(fields);
    this.form = this.fb.group(controls);
    this.applyFormAccessState();
  }

  private applyFormAccessState(): void {
    if (!this.canEdit()) {
      this.metaForm.disable({ emitEvent: false });
      this.form.disable({ emitEvent: false });
      return;
    }

    this.metaForm.enable({ emitEvent: false });
    this.form.enable({ emitEvent: false });
    this.metaForm.controls.comment.enable({ emitEvent: false });

    if (!(this.access().edit_status || this.access().manage)) {
      this.metaForm.controls.status.disable({ emitEvent: false });
    }

    if (!(this.access().edit_visibility || this.access().manage)) {
      this.metaForm.controls.visibility_level.disable({ emitEvent: false });
    }
  }

  private async loadReferenceTitles(entry: EntryRecord, schema: EntrySchema | null): Promise<void> {
    if (!schema) {
      this.referenceTitles.set({});
      return;
    }

    const tasks = sortSchemaFields(schema.fields)
      .filter((field) => field.data_type === 'reference' && !supportsMultiple(field))
      .map(async (field) => {
        const schemaKey = getReferenceSchemaKey(field);
        const rawValue = getFieldValue(entry, field);
        if (!schemaKey || (typeof rawValue !== 'string' && typeof rawValue !== 'number')) {
          return null;
        }
        try {
          const referenced = await firstValueFrom(this.entryService.getEntry(rawValue));
          return [String(rawValue), resolveEntryTitle(referenced)] as const;
        } catch {
          return [String(rawValue), String(rawValue)] as const;
        }
      });

    const resolved = await Promise.all(tasks);
    this.referenceTitles.set(
      resolved.reduce<Record<string, string>>((result, item) => {
        if (item) {
          result[item[0]] = item[1];
        }
        return result;
      }, {})
    );
  }

  private buildDataJson(): Record<string, unknown> {
    return this.fields().reduce<Record<string, unknown>>((result, item) => {
      const value = this.normalizeFieldValue(item.field, item.control.value);
      if (value !== undefined) {
        result[item.field.key] = value;
      }
      return result;
    }, {});
  }

  private prepareFieldControlValue(entry: EntryRecord, field: SchemaField): unknown {
    const value = getFieldValue(entry, field);
    if (value == null) {
      if (field.data_type === 'boolean') {
        return false;
      }
      if (supportsMultiple(field)) {
        return [];
      }
      return '';
    }

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

  private normalizeFieldValue(field: SchemaField, value: unknown): unknown {
    if (field.data_type === 'boolean') {
      return this.toBoolean(value);
    }

    if (field.data_type === 'multi_select') {
      const values = this.toArrayValue(value);
      return values.length > 0 || field.is_required ? values : undefined;
    }

    if ((field.data_type === 'reference' || field.data_type === 'file') && supportsMultiple(field)) {
      const values = this.toArrayValue(value);
      return values.length > 0 || field.is_required ? values : undefined;
    }

    if (value === '' || value === null || value === undefined) {
      return field.is_required ? value : undefined;
    }

    switch (field.data_type) {
      case 'integer':
        return Number.parseInt(String(value), 10);
      case 'decimal':
        return Number.parseFloat(String(value));
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'datetime':
        return typeof value === 'string' && value.length > 0 ? new Date(value).toISOString() : value;
      case 'reference':
      case 'file':
        return String(value).trim();
      default:
        return typeof value === 'string' ? value.trim() : value;
    }
  }

  private coerceDisplayValue(field: SchemaField, value: unknown): unknown {
    if (value === '' || value === null || value === undefined) {
      return null;
    }

    if (field.data_type === 'json' && typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    if (field.data_type === 'multi_select') {
      return this.toArrayValue(value);
    }

    if ((field.data_type === 'reference' || field.data_type === 'file') && supportsMultiple(field)) {
      return this.toArrayValue(value);
    }

    return value;
  }

  private labelForHistoryKey(key: string): string {
    const match = this.schema()?.fields.find((field) => field.key === key);
    return match ? this.fieldLabel(match) : humanizeKey(key);
  }

  private formatReadableDate(value: unknown, withTime: boolean): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return '';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.translate.currentLang || undefined, {
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' } : {})
    }).format(parsed);
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

  private emptyAccess(): EntryAccessMap {
    return {
      read: false,
      view_history: false,
      edit: false,
      edit_status: false,
      edit_visibility: false,
      manage_relations: false,
      manage_attachments: false,
      manage_permissions: false,
      delete: false,
      manage: false
    };
  }

  private describeError(error: unknown, action: 'load' | 'save' | 'delete'): string {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : '';

    if (!message) {
      return this.translate.instant('entryDetail.errors.loadFallback');
    }

    return this.translate.instant(`entryDetail.errors.${action}Failed`, { message });
  }

  private toFieldKey(label: string): string {
    return label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}
