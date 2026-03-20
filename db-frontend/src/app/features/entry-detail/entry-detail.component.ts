import { DatePipe, JsonPipe, NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, forkJoin, of } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/services/auth.service';
import { EntryService } from '../../core/services/entry.service';
import { SchemaService } from '../../core/services/schema.service';
import {
  AttachmentRecord,
  EntryAccessMap,
  EntryHistoryRecord,
  EntryPermissionRecord,
  EntryRecord,
  EntryRelationRecord,
  EntrySchema,
  SchemaField
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
  imports: [NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, ReactiveFormsModule, JsonPipe, RouterModule, DatePipe, TranslateModule],
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
  readonly entryTitle = computed(() => {
    const entry = this.entry();
    return entry ? resolveEntryTitle(entry, this.schema()) : this.translate.instant('entryDetail.labels.unknownId');
  });
  readonly canEdit = computed(() => this.access().manage || this.access().edit);

  readonly metaForm = this.fb.nonNullable.group({
    title: ['', Validators.required],
    status: [''],
    visibility_level: ['internal'],
    owner_id: [''],
    comment: ['']
  });

  form: FormGroup = this.fb.group({});
  private currentSchemaKey: string | null = null;
  private currentEntryId: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const schemaKey = params.get('schemaKey');
      const entryId = params.get('id');
      if (!schemaKey || !entryId) {
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
      const updated = await firstValueFrom(
        this.entryService.updateEntry(entry.id, {
          title: this.metaForm.getRawValue().title.trim(),
          status: this.access().edit_status || this.access().manage ? this.metaForm.getRawValue().status.trim() || null : undefined,
          visibility_level:
            this.access().edit_visibility || this.access().manage
              ? (this.metaForm.getRawValue().visibility_level as EntryRecord['visibility_level'])
              : undefined,
          owner_id: this.metaForm.getRawValue().owner_id.trim() || null,
          comment: this.metaForm.getRawValue().comment.trim() || null,
          data_json: this.buildDataJson()
        })
      );
      this.successMessage.set(this.translate.instant('entryDetail.status.saved'));
      this.entry.set(updated);
      this.rebuildForms(updated, this.schema());
      await this.loadSecondaryData(updated.id);
      this.applyFormAccessState();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteEntry(): Promise<void> {
    const entry = this.entry();
    if (!entry || !(this.access().delete || this.access().manage)) {
      return;
    }

    try {
      await firstValueFrom(this.entryService.softDeleteEntry(entry.id, this.metaForm.getRawValue().comment.trim()));
      await this.router.navigate(['/entries', this.currentSchemaKey]);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    }
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

  renderFieldValue(field: SchemaField): string {
    const value = getFieldValue(this.entry()!, field);
    return formatFieldValue(value, field);
  }

  renderHistoryDiff(record: EntryHistoryRecord): string[] {
    const before = record.old_data_json ?? {};
    const after = record.new_data_json ?? {};
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return keys
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => `${humanizeKey(key)}: ${formatFieldValue(before[key])} -> ${formatFieldValue(after[key])}`);
  }

  referenceLink(field: SchemaField): string[] | null {
    const rawValue = getFieldValue(this.entry()!, field);
    const schemaKey = getReferenceSchemaKey(field);
    if (!schemaKey || (typeof rawValue !== 'string' && typeof rawValue !== 'number')) {
      return null;
    }
    return ['/entries', schemaKey, String(rawValue)];
  }

  referenceLabel(field: SchemaField): string {
    const rawValue = getFieldValue(this.entry()!, field);
    const id = String(rawValue ?? '').trim();
    return this.referenceTitles()[id] ?? id;
  }

  attachmentUrl(attachment: AttachmentRecord): string | null {
    const candidate = attachment.external_url ?? attachment.stored_path ?? null;
    return candidate && candidate.trim().length > 0 ? candidate : null;
  }

  private async load(): Promise<void> {
    if (!this.currentEntryId || !this.currentSchemaKey) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const entry = await firstValueFrom(this.entryService.getEntry(this.currentEntryId));
      const schema = await this.resolveSchema(entry.schema_id, this.currentSchemaKey);
      this.entry.set(entry);
      this.schema.set(schema);
      this.rebuildForms(entry, schema);
      await this.loadSecondaryData(entry.id);
      this.applyFormAccessState();
      await this.loadReferenceTitles(entry, schema);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private async resolveSchema(schemaId: string | number, schemaKey: string): Promise<EntrySchema | null> {
    const schemas = await firstValueFrom(this.schemaService.loadSchemas());
    const cached = schemas.find((item) => String(item.id) === String(schemaId) || item.key === schemaKey) ?? null;
    if (cached) {
      return cached;
    }
    return await firstValueFrom(this.schemaService.getSchema(schemaId));
  }

  private rebuildForms(entry: EntryRecord, schema: EntrySchema | null): void {
    this.metaForm.patchValue({
      title: entry.title,
      status: entry.status ?? '',
      visibility_level: entry.visibility_level,
      owner_id: entry.owner_id != null ? String(entry.owner_id) : '',
      comment: ''
    });

    const controls: Record<string, FormControl<unknown>> = {};
    const fields = sortSchemaFields(schema?.fields ?? []).map<DetailField>((field) => {
      const validators = field.is_required ? [Validators.required] : [];
      const control = this.fb.control(getFieldValue(entry, field), validators);
      controls[field.key] = control;
      return { field, control };
    });

    this.fields.set(fields);
    this.form = this.fb.group(controls);
    this.applyFormAccessState();
  }

  private async loadSecondaryData(entryId: string | number): Promise<void> {
    const access = await firstValueFrom(this.entryService.loadAccessMap(entryId));
    this.access.set(access);

    const loaders = {
      relations: access.manage_relations || access.read ? this.entryService.getRelations(entryId) : null,
      attachments: access.manage_attachments || access.read ? this.entryService.getAttachments(entryId) : null,
      history: access.view_history || access.manage ? this.entryService.getHistory(entryId) : null,
      permissions: access.manage_permissions || access.manage ? this.entryService.getPermissions(entryId) : null
    };

    const requests = forkJoin({
      relations: loaders.relations ?? of([] as EntryRelationRecord[]),
      attachments: loaders.attachments ?? of([] as AttachmentRecord[]),
      history: loaders.history ?? of([] as EntryHistoryRecord[]),
      permissions: loaders.permissions ?? of([] as EntryPermissionRecord[])
    });

    const result: {
      relations: EntryRelationRecord[];
      attachments: AttachmentRecord[];
      history: EntryHistoryRecord[];
      permissions: EntryPermissionRecord[];
    } = await firstValueFrom(requests);
    this.relations.set(result.relations);
    this.attachments.set(result.attachments);
    this.history.set(result.history);
    this.permissions.set(result.permissions);
  }

  private applyFormAccessState(): void {
    if (!this.canEdit()) {
      this.metaForm.disable({ emitEvent: false });
      this.form.disable({ emitEvent: false });
      return;
    }

    this.metaForm.enable({ emitEvent: false });
    this.form.enable({ emitEvent: false });

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
      case 'datetime':
        return typeof value === 'string' && value.length > 0 ? new Date(value).toISOString() : value;
      case 'reference':
      case 'file':
        if (supportsMultiple(field)) {
          return Array.isArray(value) ? value : String(value).split(',').map((item) => item.trim()).filter(Boolean);
        }
        return String(value).trim();
      default:
        return typeof value === 'string' ? value.trim() : value;
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

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('entryDetail.errors.loadFallback');
  }
}
