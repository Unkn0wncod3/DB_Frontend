import { DatePipe, NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Observable, Subscription } from 'rxjs';

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

interface RelationLookupItem {
  id: string | number;
  title: string;
  schema_id: string | number;
  schema_key: string;
  schema_name: string;
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
  readonly createFieldError = signal<string | null>(null);
  readonly isRelationDialogOpen = signal(false);
  readonly isLeaveDialogOpen = signal(false);
  readonly isSavingRelation = signal(false);
  readonly isDeletingRelation = signal(false);
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
  readonly relationEntries = signal<RelationLookupItem[]>([]);
  readonly relationLookupEntries = signal<RelationLookupItem[]>([]);
  readonly relationSearch = signal('');
  readonly relationTypeFilter = signal<'all' | string>('all');
  readonly relationSchemaFilter = signal<'all' | string>('all');
  readonly originalComparableState = signal('');
  readonly formRevision = signal(0);
  readonly visibilityLevels: VisibilityLevel[] = ['public', 'internal', 'restricted', 'private'];
  readonly defaultStatusOptions = ['draft', 'review', 'active', 'inactive', 'archived'];
  readonly fieldTypes: FieldDataType[] = ['text', 'long_text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'email', 'url', 'select', 'multi_select', 'reference', 'file', 'json'];
  readonly relationTypes = ['belongs_to', 'parent_of', 'references', 'assigned_to', 'contains', 'related_to'] as const;
  readonly editingField = signal<SchemaField | null>(null);
  readonly editingRelation = signal<EntryRelationRecord | null>(null);

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
  readonly hasCommentDraft = computed(() => {
    this.formRevision();
    return this.metaForm.getRawValue().comment.trim().length > 0;
  });
  readonly hasUnsavedChanges = computed(() => {
    this.formRevision();
    return this.originalComparableState().length > 0 && this.currentComparableState() !== this.originalComparableState();
  });
  readonly canSave = computed(() => {
    this.formRevision();
    return this.canEdit() && !this.isSaving() && !this.form.invalid && !this.metaForm.invalid && (this.hasUnsavedChanges() || this.hasCommentDraft());
  });
  readonly statusOptions = computed(() => {
    const current = this.metaForm.controls.status.getRawValue().trim();
    return Array.from(new Set([current, ...this.defaultStatusOptions].filter((value) => value.length > 0)));
  });
  readonly filteredRelations = computed(() => {
    const search = this.relationSearch().trim().toLowerCase();
    const typeFilter = this.relationTypeFilter();
    const currentEntryId = String(this.entry()?.id ?? '');

    return [...this.relations()]
      .filter((relation) => {
        if (typeFilter !== 'all' && relation.relation_type !== typeFilter) {
          return false;
        }

        if (!search) {
          return true;
        }

        const counterpart = this.relationCounterpart(relation);
        const haystack = [
          relation.relation_type,
          relation.from_entry_id,
          relation.to_entry_id,
          relation.sort_order ?? 0,
          counterpart?.title,
          counterpart?.schema_name,
          counterpart?.schema_key,
          currentEntryId === String(relation.from_entry_id) ? 'outgoing' : 'incoming',
          relation.metadata_json ? JSON.stringify(relation.metadata_json) : ''
        ]
          .filter((value) => value != null)
          .join(' ')
          .toLowerCase();

        return haystack.includes(search);
      })
      .sort((left, right) => {
        const orderDiff = (left.sort_order ?? 0) - (right.sort_order ?? 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }

        return String(right.created_at ?? '').localeCompare(String(left.created_at ?? ''));
      });
  });
  readonly relationCandidates = computed(() => {
    const search = this.relationSearch().trim().toLowerCase();
    const schemaFilter = this.relationSchemaFilter();
    const currentEntryId = String(this.entry()?.id ?? '');
    const selectedId = String(this.relationForm.controls.to_entry_id.getRawValue() ?? '');

    return this.relationLookupEntries()
      .filter((item) => {
        if (String(item.id) === currentEntryId) {
          return false;
        }
        if (schemaFilter !== 'all' && String(item.schema_id) !== schemaFilter) {
          return false;
        }
        if (!search) {
          return true;
        }

        return [item.title, item.schema_name, item.schema_key, item.id].join(' ').toLowerCase().includes(search);
      })
      .sort((left, right) => {
        const leftSelected = String(left.id) === selectedId;
        const rightSelected = String(right.id) === selectedId;
        if (leftSelected !== rightSelected) {
          return leftSelected ? -1 : 1;
        }

        return left.title.localeCompare(right.title);
      })
      .slice(0, 24);
  });
  readonly relationSchemaOptions = computed(() => {
    const seen = new Set<string>();
    return this.relationLookupEntries().filter((item) => {
      const key = String(item.schema_id);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
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
  readonly relationForm = this.fb.nonNullable.group({
    to_entry_id: ['', Validators.required],
    relation_type: ['references'],
    sort_order: [0]
  });

  form: FormGroup = this.fb.group({});
  private currentSchemaKey: string | null = null;
  private currentEntryId: string | null = null;
  private formValueSubscription?: Subscription;
  private pendingLeaveResolver: ((allow: boolean) => void) | null = null;
  private createFieldKeyAutoSync = true;

  constructor() {
    this.metaForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formRevision.update((value) => value + 1);
    });

    this.createFieldForm.controls.label.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      if (!this.createFieldKeyAutoSync || this.editingField()) {
        return;
      }
      this.createFieldForm.controls.key.setValue(this.toFieldKey(value), { emitEvent: false });
    });

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

  hasPendingChanges(): boolean {
    return this.canEdit() && (this.hasUnsavedChanges() || this.hasCommentDraft());
  }

  confirmDiscardChanges(): boolean | Promise<boolean> {
    if (!this.hasPendingChanges()) {
      return true;
    }

    this.pendingLeaveResolver?.(false);
    this.isLeaveDialogOpen.set(true);

    return new Promise<boolean>((resolve) => {
      this.pendingLeaveResolver = resolve;
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasPendingChanges()) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  stayOnPage(): void {
    this.resolveLeaveDecision(false);
  }

  leaveWithoutSaving(): void {
    this.resolveLeaveDecision(true);
  }

  async save(): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.canSave()) {
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
    this.createFieldKeyAutoSync = true;
    this.createFieldForm.reset({ label: '', key: '', description: '', data_type: 'text', is_required: false });
    this.createFieldError.set(null);
    this.isFieldDialogOpen.set(true);
  }

  editField(field: SchemaField): void {
    if (!this.auth.canManageSchemas()) {
      return;
    }
    this.editingField.set(field);
    this.createFieldKeyAutoSync = false;
    this.createFieldForm.reset({
      label: field.label ?? '',
      key: field.key ?? '',
      description: field.description ?? '',
      data_type: field.data_type,
      is_required: field.is_required
    });
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

  async openRelationDialog(relation?: EntryRelationRecord): Promise<void> {
    const entry = this.entry();
    if (!entry || !(this.access().manage_relations || this.access().manage)) {
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);

    if (relation) {
      this.editingRelation.set(relation);
      this.relationForm.reset({
        to_entry_id: String(relation.to_entry_id),
        relation_type: relation.relation_type,
        sort_order: relation.sort_order ?? 0
      });
    } else {
      this.editingRelation.set(null);
      this.relationForm.reset({
        to_entry_id: '',
        relation_type: 'references',
        sort_order: 0
      });
    }

    this.relationSearch.set('');
    this.relationSchemaFilter.set('all');
    await this.loadRelationLookupEntries();
    this.ensureSelectedRelationLookupTarget();
    this.isRelationDialogOpen.set(true);
  }

  closeRelationDialog(): void {
    this.isRelationDialogOpen.set(false);
    this.editingRelation.set(null);
    this.relationLookupEntries.set([]);
  }

  async onRelationLookupSearchInput(value: string): Promise<void> {
    this.relationSearch.set((value || '').trim());
    await this.loadRelationLookupEntries();
    this.ensureSelectedRelationLookupTarget();
  }

  async onRelationLookupSchemaFilterChange(value: string): Promise<void> {
    this.relationSchemaFilter.set(value || 'all');
    await this.loadRelationLookupEntries();
    this.ensureSelectedRelationLookupTarget();
  }

  async saveRelation(): Promise<void> {
    const entry = this.entry();
    if (!entry || this.relationForm.invalid || this.isSavingRelation()) {
      return;
    }

    this.isSavingRelation.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const raw = this.relationForm.getRawValue();
      const payload = {
        to_entry_id: Number.parseInt(raw.to_entry_id, 10),
        relation_type: raw.relation_type,
        sort_order: Number(raw.sort_order || 0),
        metadata_json: {}
      };

      const editingRelation = this.editingRelation();
      if (editingRelation) {
        await firstValueFrom(this.entryService.updateRelation(entry.id, editingRelation.id, payload));
        this.successMessage.set(this.translate.instant('entryDetail.relations.status.updated'));
      } else {
        await firstValueFrom(this.entryService.createRelation(entry.id, payload));
        this.successMessage.set(this.translate.instant('entryDetail.relations.status.created'));
      }

      this.closeRelationDialog();
      await this.reloadRelations();
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'save'));
    } finally {
      this.isSavingRelation.set(false);
    }
  }

  async deleteRelation(relation?: EntryRelationRecord): Promise<void> {
    const entry = this.entry();
    const targetRelation = relation ?? this.editingRelation();
    if (!entry || !targetRelation || this.isDeletingRelation()) {
      return;
    }

    this.isDeletingRelation.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await firstValueFrom(this.entryService.deleteRelation(entry.id, targetRelation.id));
      this.successMessage.set(this.translate.instant('entryDetail.relations.status.deleted'));
      if (!relation) {
        this.closeRelationDialog();
      }
      await this.reloadRelations();
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'delete'));
    } finally {
      this.isDeletingRelation.set(false);
    }
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
          this.schemaService.updateField(schema.id, editingField.id, {
            key: normalizedKey,
            label,
            description: raw.description.trim() || null,
            data_type: raw.data_type,
            is_required: raw.is_required
          })
        );
      } else {
        await firstValueFrom(
          this.schemaService.createField(schema.id, {
            key: normalizedKey,
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
      const message = this.describeError(error, 'load');
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
      await this.load();
      this.successMessage.set(this.translate.instant('schemaFields.status.deleted', { value: field.label || field.key }));
    } catch (error) {
      this.errorMessage.set(this.describeError(error, 'load'));
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
    return field.data_type === 'long_text' || field.data_type === 'json';
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

  relationCounterpart(relation: EntryRelationRecord): RelationLookupItem | null {
    const currentEntryId = String(this.entry()?.id ?? '');
    const counterpartId =
      String(relation.from_entry_id) === currentEntryId ? String(relation.to_entry_id) : String(relation.from_entry_id);
    return this.relationEntries().find((item) => String(item.id) === counterpartId) ?? null;
  }

  relationCounterpartLink(relation: EntryRelationRecord): string[] | null {
    const counterpart = this.relationCounterpart(relation);
    return counterpart ? ['/entries', counterpart.schema_key, String(counterpart.id)] : null;
  }

  relationDirectionLabel(relation: EntryRelationRecord): string {
    return String(relation.from_entry_id) === String(this.entry()?.id ?? '')
      ? this.translate.instant('entryDetail.relations.direction.outgoing')
      : this.translate.instant('entryDetail.relations.direction.incoming');
  }

  relationTypeLabel(type: string): string {
    return this.translate.instant(`entryDetail.relations.types.${type}`);
  }

  relationCandidateSubtitle(item: RelationLookupItem): string {
    return `${item.schema_name} · #${item.id}`;
  }

  selectRelationCandidate(item: RelationLookupItem): void {
    this.relationForm.controls.to_entry_id.setValue(String(item.id));
  }

  isSelectedRelationCandidate(item: RelationLookupItem): boolean {
    return String(item.id) === String(this.relationForm.controls.to_entry_id.getRawValue() ?? '');
  }

  selectedRelationTarget(): RelationLookupItem | null {
    const selectedId = String(this.relationForm.controls.to_entry_id.getRawValue() ?? '');
    return this.relationLookupEntries().find((item) => String(item.id) === selectedId) ?? this.relationEntries().find((item) => String(item.id) === selectedId) ?? null;
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
      await this.loadRelationEntries();
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

  private async reloadRelations(): Promise<void> {
    const entry = this.entry();
    if (!entry) {
      return;
    }

    const relations = await firstValueFrom(this.entryService.getRelations(entry.id));
    this.relations.set(relations);
    await this.loadRelationEntries();
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
    this.formValueSubscription?.unsubscribe();
    this.form = this.fb.group(controls);
    this.formValueSubscription = this.form.valueChanges.subscribe(() => {
      this.formRevision.update((value) => value + 1);
    });
    this.applyFormAccessState();
    this.originalComparableState.set(this.serializeComparableState(entry, schema));
    this.formRevision.update((value) => value + 1);
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

  private async loadRelationEntries(): Promise<void> {
    const [schemas, entries] = await Promise.all([
      firstValueFrom(this.schemaService.loadSchemas(false, true)),
      firstValueFrom(this.entryService.listEntries({}) as Observable<EntryRecord[]>)
    ]);

    const schemaMap = new Map(schemas.map((schema) => [String(schema.id), schema]));
    const items = (entries as EntryRecord[]).map<RelationLookupItem>((item) => {
      const relatedSchema = schemaMap.get(String(item.schema_id));
      return {
        id: item.id,
        title: resolveEntryTitle(item, relatedSchema ?? null),
        schema_id: item.schema_id,
        schema_key: relatedSchema?.key ?? '',
        schema_name: relatedSchema?.name ?? this.translate.instant('entryDetail.labels.unknownId')
      };
    });

    this.relationEntries.set(items);
  }

  private async loadRelationLookupEntries(): Promise<void> {
    const schemaFilter = this.relationSchemaFilter();
    const lookupEntries = await firstValueFrom(
      this.entryService.lookupEntries({
        q: this.relationSearch().trim() || undefined,
        schema_id: schemaFilter !== 'all' ? schemaFilter : undefined,
        limit: 24
      })
    );

    const currentEntryId = String(this.entry()?.id ?? '');
    this.relationLookupEntries.set(
      lookupEntries
        .filter((item) => String(item.id) !== currentEntryId)
        .map<RelationLookupItem>((item) => ({
          id: item.id,
          title: item.title,
          schema_id: item.schema_id,
          schema_key: item.schema_key,
          schema_name: item.schema_name
        }))
    );
  }

  private ensureSelectedRelationLookupTarget(): void {
    const selectedId = String(this.relationForm.controls.to_entry_id.getRawValue() ?? '');
    if (!selectedId) {
      return;
    }

    const existsInLookup = this.relationLookupEntries().some((item) => String(item.id) === selectedId);
    if (existsInLookup) {
      return;
    }

    const fallback = this.relationEntries().find((item) => String(item.id) === selectedId);
    if (!fallback) {
      return;
    }

    this.relationLookupEntries.set([fallback, ...this.relationLookupEntries()]);
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

  private currentComparableState(): string {
    const entry = this.entry();
    const schema = this.schema();
    if (!entry) {
      return '';
    }

    return this.serializeComparableState({
      ...entry,
      title: this.metaForm.getRawValue().title.trim(),
      status: this.metaForm.getRawValue().status.trim() || null,
      visibility_level: this.metaForm.getRawValue().visibility_level as VisibilityLevel,
      owner_id: this.normalizeIdentifierValue(this.metaForm.getRawValue().owner_id.trim(), false) ?? null,
      data_json: this.buildDataJson()
    }, schema);
  }

  private serializeComparableState(
    entry: Pick<EntryRecord, 'title' | 'status' | 'visibility_level' | 'owner_id' | 'data_json'>,
    schema: EntrySchema | null
  ): string {
    return JSON.stringify({
      title: entry.title?.trim() ?? '',
      status: entry.status ?? null,
      visibility_level: entry.visibility_level ?? 'internal',
      owner_id: entry.owner_id ?? null,
      data_json: this.normalizeComparableDataJson(entry, schema)
    });
  }

  private normalizeComparableDataJson(
    entry: Pick<EntryRecord, 'data_json'>,
    schema: EntrySchema | null
  ): Record<string, unknown> {
    if (!schema) {
      return entry.data_json ?? {};
    }

    return sortSchemaFields(schema.fields ?? []).reduce<Record<string, unknown>>((result, field) => {
      const prepared = this.prepareFieldControlValue(
        {
          data_json: entry.data_json ?? {}
        } as EntryRecord,
        field
      );
      const normalized = this.normalizeFieldValue(field, prepared);
      if (normalized !== undefined) {
        result[field.key] = normalized;
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
        return this.normalizeIdentifierValue(value, field.is_required);
      case 'file':
        return this.normalizeIdentifierValue(value, field.is_required);
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

  private normalizeIdentifierValue(value: unknown, isRequired: boolean): string | number | undefined {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return isRequired ? '' : undefined;
    }

    return /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : normalized;
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

  private resolveLeaveDecision(allow: boolean): void {
    const resolver = this.pendingLeaveResolver;
    this.pendingLeaveResolver = null;
    this.isLeaveDialogOpen.set(false);
    resolver?.(allow);
  }
}
