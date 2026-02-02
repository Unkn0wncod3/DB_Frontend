import { DatePipe, JsonPipe, NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, WritableSignal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { EntryService } from '../../core/services/entry.service';
import { ApiService } from '../../core/services/api.service';
import { ValueDropdownComponent, ValueDropdownOption } from '../../shared/components/value-dropdown/value-dropdown.component';

interface EntryFieldConfig {
  key: string;
  label: string;
  multiline: boolean;
  readOnly: boolean;
  inputType: EntryFieldInputType;
  dateVariant?: 'date' | 'datetime';
}

interface RelatedEntryItem {
  id?: string;
  label: string;
  description?: string;
  timestamp?: string;
  routerLink?: string[];
  type: string;
}

type EntryFieldInputType = 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';

@Component({
  selector: 'app-entry-detail',
  standalone: true,
  imports: [NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault, ReactiveFormsModule, JsonPipe, TranslateModule, RouterModule, DatePipe, ValueDropdownComponent],
  templateUrl: './entry-detail.component.html',
  styleUrls: ['./entry-detail.component.scss', './entry-detail-modal.component.scss', './entry-detail-relations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly entryService = inject(EntryService);
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly isDeleting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly entry = signal<Record<string, unknown> | null>(null);
  readonly fields: WritableSignal<EntryFieldConfig[]> = signal([]);
  readonly entryTitle = signal<string | null>(null);
  readonly relatedProfiles = signal<RelatedEntryItem[]>([]);
  readonly relatedNotes = signal<RelatedEntryItem[]>([]);
  readonly relatedActivities = signal<RelatedEntryItem[]>([]);
  readonly isRelationsLoading = signal(false);
  readonly relationsError = signal<string | null>(null);
  readonly hasRelations = computed(() => this.relatedProfiles().length > 0 || this.relatedNotes().length > 0 || this.relatedActivities().length > 0);
  readonly booleanOptions = signal<ValueDropdownOption[]>([]);
  private readonly readOnlyKeys = new Set(['id', '_id', 'type', 'createdat', 'updatedat', 'created_at', 'updated_at', 'timestamp', 'occurredat', 'occurred_at']);
  readonly deleteSecurityKey = 'del1';
  readonly isDeleteDialogOpen = signal(false);
  readonly deletePasscode = signal('');
  readonly deleteDialogError = signal<string | null>(null);
  readonly isManagingProfileLinks = signal(false);
  readonly profileLinkError = signal<string | null>(null);
  readonly profileLinkForm = this.fb.nonNullable.group({
    profileId: ['', [Validators.required]],
    note: ['']
  });

  form: FormGroup = this.fb.group({});

  private currentType: string | null = null;
  private currentId: string | null = null;
  private fieldConfigMap = new Map<string, EntryFieldConfig>();

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const type = params.get('type');
      const id = params.get('id');

      if (!type || !id) {
        this.errorMessage.set(this.translate.instant('entryDetail.errors.missingParams'));
        return;
      }

      if (type === this.currentType && id === this.currentId) {
        return;
      }

      this.currentType = type;
      this.currentId = id;
      void this.loadEntry();
    });

    this.booleanOptions.set(this.buildBooleanOptions());
    this.translate.onLangChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.booleanOptions.set(this.buildBooleanOptions());
    });
  }

  openDeleteDialog(): void {
    if (!this.currentType || !this.currentId) {
      return;
    }
    this.deletePasscode.set('');
    this.deleteDialogError.set(null);
    this.isDeleteDialogOpen.set(true);
  }

  closeDeleteDialog(): void {
    if (this.isDeleting()) {
      return;
    }
    this.isDeleteDialogOpen.set(false);
    this.deletePasscode.set('');
    this.deleteDialogError.set(null);
  }

  onDeletePasscodeChange(value: string): void {
    this.deletePasscode.set(value);
    if (this.deleteDialogError()) {
      this.deleteDialogError.set(null);
    }
  }

  canConfirmDelete(): boolean {
    return this.deletePasscode().trim() === this.deleteSecurityKey && !this.isDeleting();
  }

  async confirmDelete(): Promise<void> {
    if (!this.canConfirmDelete()) {
      this.deleteDialogError.set(this.translate.instant('entryDetail.delete.passcodeInvalid'));
      return;
    }

    await this.performDelete();
    this.closeDeleteDialog();
  }

  async refresh(): Promise<void> {
    await this.loadEntry(true);
  }

  async save(): Promise<void> {
    if (!this.currentType || !this.currentId || this.form.invalid) {
      return;
    }

    const payload = this.buildPayload();

    if (Object.keys(payload).length === 0) {
      this.successMessage.set(this.translate.instant('entryDetail.status.noChanges'));
      this.form.markAsPristine();
      return;
    }

    this.clearMessages();
    this.isSaving.set(true);

    try {
      const updated = await firstValueFrom(
        this.entryService.updateEntry(this.currentType, this.currentId, payload)
      );

      if (updated && typeof updated === 'object') {
        this.entry.set(updated as Record<string, unknown>);
        this.rebuildForm(updated as Record<string, unknown>);
      }

      this.successMessage.set(this.translate.instant('entryDetail.status.saved'));
    } catch (error) {
      this.errorMessage.set(this.translate.instant('entryDetail.errors.saveFailed', {
        message: this.describeError(error)
      }));
    } finally {
      this.isSaving.set(false);
    }
  }

  private async performDelete(): Promise<void> {
    if (!this.currentType || !this.currentId || this.isDeleting()) {
      return;
    }

    this.clearMessages();
    this.isDeleting.set(true);

    try {
      await firstValueFrom(this.entryService.deleteEntry(this.currentType, this.currentId));
      this.successMessage.set(this.translate.instant('entryDetail.status.deleted'));
      await this.router.navigate(['/']);
    } catch (error) {
      this.errorMessage.set(this.translate.instant('entryDetail.errors.deleteFailed', {
        message: this.describeError(error)
      }));
    } finally {
      this.isDeleting.set(false);
    }
  }

  trackByKey(_index: number, field: EntryFieldConfig): string {
    return field.key;
  }

  hasChanges(): boolean {
    return this.form.dirty && !this.isSaving();
  }

  private isReadOnlyKey(key: string): boolean {
    const normalized = key.toLowerCase();
    if (normalized === 'external_id') {
      return false;
    }
    if (this.readOnlyKeys.has(normalized)) {
      return true;
    }

    if (normalized.endsWith('id') && normalized !== 'metadata') {
      return true;
    }

    return false;
  }

  private async loadEntry(force = false): Promise<void> {
    if (!this.currentType || !this.currentId) {
      return;
    }

    if (this.isLoading() && !force) {
      return;
    }

    this.isLoading.set(true);
    this.clearMessages();

    try {
      const result = await firstValueFrom(this.entryService.getEntry(this.currentType, this.currentId));
      const record = this.ensureRecord(result);
      this.entry.set(record);
      this.rebuildForm(record);
      this.entryTitle.set(this.resolveEntryTitle(record));
      if (this.showPersonRelations()) {
        void this.loadPersonRelations(this.currentId!);
      } else {
        this.clearRelations();
      }
    } catch (error) {
      this.errorMessage.set(this.translate.instant('entryDetail.errors.loadFailed', {
        message: this.describeError(error)
      }));
    } finally {
      this.isLoading.set(false);
    }
  }

  private rebuildForm(record: Record<string, unknown>): void {
    const controls: Record<string, FormControl<string | number | boolean | null>> = {};
    const fieldConfigs: EntryFieldConfig[] = [];

    for (const [key, value] of Object.entries(record)) {
      if (this.shouldHideField(key)) {
        continue;
      }

      const inputType = this.detectFieldType(key, value);
      const readOnly = this.isReadOnlyKey(key);
      const controlValue = this.prepareControlValue(value, inputType);
      const control = this.fb.control<string | number | boolean | null>(controlValue);

      if (readOnly) {
        control.disable({ emitEvent: false });
      }

      controls[key] = control;
      const stringValue = typeof controlValue === 'string' ? controlValue : this.stringifyValue(controlValue);
      const dateVariant = inputType === 'date' || inputType === 'datetime' ? inputType : undefined;

      fieldConfigs.push({
        key,
        label: this.humanizeKey(key),
        multiline: inputType === 'textarea' || inputType === 'json',
        readOnly,
        inputType,
        dateVariant
      });
    }

    this.form = this.fb.nonNullable.group(controls);
    this.fields.set(fieldConfigs);
    this.fieldConfigMap = new Map(fieldConfigs.map((config) => [config.key, config]));
    this.form.markAsPristine();
  }

  private shouldHideField(key: string): boolean {
    const normalized = key.toLowerCase();
    return normalized === 'id' || normalized === '_id';
  }

  private buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const original = this.entry();

    if (!original) {
      return payload;
    }

    const controls = this.form.controls as Record<string, FormControl<string | number | boolean | null>>;

    for (const [key, control] of Object.entries(controls)) {
      if (control.disabled) {
        continue;
      }

      const config = this.fieldConfigMap.get(key);
      const rawValue = control.value;
      const originalValue = original[key];

      if (!config) {
        continue;
      }

      const normalizedCurrent = this.normalizeValueForComparison(rawValue, config);
      const normalizedOriginal = this.normalizeValueForComparison(originalValue, config);

      if (this.valuesEqual(normalizedCurrent, normalizedOriginal, config)) {
        continue;
      }

      payload[key] = this.prepareValueForPayload(rawValue, config, originalValue);
    }

    return payload;
  }

  private looksLikeJson(value: string): boolean {
    if (!value) {
      return false;
    }

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      return false;
    }

    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    return (
      (first === '{' && last === '}') ||
      (first === '[' && last === ']') ||
      (first === '"' && last === '"')
    );
  }

  private stringifyValue(value: unknown): string {
    if (value == null) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private shouldUseTextarea(value: string): boolean {
    return value.includes('\n') || value.length > 80;
  }

  private detectFieldType(key: string, value: unknown): EntryFieldInputType {
    const normalizedKey = key.toLowerCase();

    if (normalizedKey === 'external_id') {
      return 'text';
    }

    if (this.shouldForceTextInput(normalizedKey)) {
      const stringValue = this.stringifyValue(value);
      return this.shouldUseTextarea(stringValue) ? 'textarea' : 'text';
    }

    if (this.isBooleanValue(key, value)) {
      return 'boolean';
    }

    if (typeof value === 'number') {
      return 'number';
    }

    const dateVariant = this.detectDateVariant(key, value);
    if (dateVariant) {
      return dateVariant;
    }

    const stringValue = this.stringifyValue(value);
    if (this.looksLikeJson(stringValue)) {
      return 'json';
    }

    return this.shouldUseTextarea(stringValue) ? 'textarea' : 'text';
  }

  private detectDateVariant(key: string, value: unknown): 'date' | 'datetime' | null {
    const normalizedKey = key.toLowerCase();
    const keyHint = this.dateVariantFromKey(normalizedKey);

    if (keyHint) {
      return keyHint;
    }

    if (typeof value === 'string') {
      return this.dateVariantFromString(value);
    }

    if (value instanceof Date) {
      return 'datetime';
    }

    return null;
  }

  private dateVariantFromKey(key: string): 'date' | 'datetime' | null {
    if (key.endsWith('_date') || key.includes('date_of') || key.endsWith('dob')) {
      return 'date';
    }

    if (key.endsWith('_at') || key.includes('timestamp') || key.includes('time') || key.includes('last_seen') || key.includes('occurred')) {
      return 'datetime';
    }

    return null;
  }

  private dateVariantFromString(value: string): 'date' | 'datetime' | null {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return 'date';
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(trimmed)) {
      return 'datetime';
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : 'datetime';
  }

  private prepareControlValue(value: unknown, inputType: EntryFieldInputType): string | number | boolean | null {
    switch (inputType) {
      case 'boolean':
        return this.toBoolean(value) ?? false;
      case 'number':
        return this.stringifyValue(this.toNumber(value));
      case 'date':
        return this.formatDateForInput(value, 'date');
      case 'datetime':
        return this.formatDateForInput(value, 'datetime');
      default:
        return this.stringifyValue(value);
    }
  }

  private formatDateForInput(value: unknown, variant: 'date' | 'datetime'): string {
    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (variant === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
      }
      if (variant === 'datetime' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
        return trimmed;
      }
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) {
        return this.formatDateFromTimestamp(parsed, variant);
      }
      return '';
    }

    if (value instanceof Date) {
      return this.formatDateFromTimestamp(value.getTime(), variant);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return this.formatDateFromTimestamp(value, variant);
    }

    return '';
  }

  private formatDateFromTimestamp(timestamp: number, variant: 'date' | 'datetime'): string {
    const date = new Date(timestamp);
    const pad = (num: number) => String(num).padStart(2, '0');
    const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (variant === 'date') {
      return datePart;
    }
    return `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private normalizeValueForComparison(value: unknown, config: EntryFieldConfig): unknown {
    switch (config.inputType) {
      case 'boolean':
        return this.toBoolean(value);
      case 'number':
        return this.stringifyValue(this.toNumber(value));
      case 'date':
        return this.formatDateForInput(value, 'date') || null;
      case 'datetime':
        return this.formatDateForInput(value, 'datetime') || null;
      case 'json':
        return this.stringifyValue(value).trim();
      default:
        return this.stringifyValue(value).trim();
    }
  }

  private valuesEqual(current: unknown, original: unknown, config: EntryFieldConfig): boolean {
    if (current === original) {
      return true;
    }

    if (config.inputType === 'json') {
      return this.normalizeJsonString(String(current ?? '')) === this.normalizeJsonString(String(original ?? ''));
    }

    if (typeof current === 'boolean' || typeof original === 'boolean') {
      return Boolean(current) === Boolean(original);
    }

    if (typeof current === 'number' || typeof original === 'number') {
      return Number(current) === Number(original);
    }

    return String(current ?? '') === String(original ?? '');
  }

  private normalizeJsonString(value: string): string {
    if (!value) {
      return '';
    }

    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value.trim();
    }
  }

  private prepareValueForPayload(value: unknown, config: EntryFieldConfig, originalValue: unknown): unknown {
    switch (config.inputType) {
      case 'boolean':
        return this.toBoolean(value);
      case 'number': {
        const numeric = this.toNumber(value);
        if (numeric === null) {
          return typeof value === 'string' ? value.trim() : '';
        }
        return numeric;
      }
      case 'date': {
        const formatted = this.formatDateForInput(value, 'date');
        return formatted || '';
      }
      case 'datetime': {
        const formatted = this.formatDateForInput(value, 'datetime');
        if (!formatted) {
          return '';
        }
        return new Date(formatted).toISOString();
      }
      case 'json':
        return this.parseJsonValue(value, originalValue);
      default:
        return typeof value === 'string' ? value.trim() : this.stringifyValue(value).trim();
    }
  }

  private parseJsonValue(value: unknown, fallback: unknown): unknown {
    const text = this.stringifyValue(value).trim();
    if (!text) {
      return '';
    }

    try {
      return JSON.parse(text);
    } catch {
      return fallback ?? text;
    }
  }

  private isBooleanValue(key: string, value: unknown): boolean {
    if (typeof value === 'boolean') {
      return true;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(normalized);
    }

    if (typeof value === 'number' && (value === 0 || value === 1)) {
      return this.isBooleanKey(key);
    }

    return false;
  }

  private shouldForceTextInput(normalizedKey: string): boolean {
    return (
      normalizedKey.includes('address') ||
      normalizedKey.includes('street') ||
      normalizedKey.includes('postal') ||
      normalizedKey.includes('zipcode') ||
      normalizedKey.includes('zip_code') ||
      normalizedKey.includes('zip')
    );
  }

  private isBooleanKey(key: string): boolean {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('is_') || normalized.startsWith('has_')) {
      return true;
    }

    const suffixPatterns = ['_flag', '_enabled', '_disabled', '_allowed'];
    if (suffixPatterns.some((suffix) => normalized.endsWith(suffix))) {
      return true;
    }

    const exactMatches = new Set(['pinned', 'verified', 'blocked', 'active']);
    if (exactMatches.has(normalized)) {
      return true;
    }

    return false;
  }

  private toBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
      return null;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private buildBooleanOptions(): ValueDropdownOption[] {
    return [
      { label: this.translate.instant('entryCreate.form.booleanTrue'), value: true },
      { label: this.translate.instant('entryCreate.form.booleanFalse'), value: false }
    ];
  }

  private humanizeKey(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private ensureRecord(payload: unknown): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }

    throw new Error(this.translate.instant('entryDetail.errors.invalidPayload'));
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }

    return this.translate.instant('entryDetail.errors.unknown');
  }

  get entryType(): string | null {
    return this.currentType;
  }

  get entryId(): string | null {
    return this.currentId;
  }

  showPersonRelations(): boolean {
    return (this.currentType ?? '').toLowerCase() === 'persons';
  }

  relationListLink(type: string): string[] {
    return ['/entries', type];
  }

  trackByRelation(_index: number, item: RelatedEntryItem): string {
    return `${item.type}-${item.id ?? _index}`;
  }

  async linkProfile(): Promise<void> {
    if (!this.showPersonRelations() || !this.currentId) {
      return;
    }

    this.profileLinkForm.markAllAsTouched();
    if (this.profileLinkForm.invalid) {
      this.profileLinkError.set(this.translate.instant('entryDetail.relations.profileLinkInvalid'));
      return;
    }

    const raw = this.profileLinkForm.getRawValue();
    const parsedId = Number(raw.profileId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      this.profileLinkError.set(this.translate.instant('entryDetail.relations.profileLinkInvalid'));
      return;
    }

    this.profileLinkError.set(null);
    this.isManagingProfileLinks.set(true);
    try {
      await firstValueFrom(
        this.api.request('POST', `/persons/${this.currentId}/profiles`, {
          body: {
            profile_id: parsedId,
            note: raw.note?.trim().length ? raw.note.trim() : null
          }
        })
      );
      this.profileLinkForm.reset({ profileId: '', note: '' });
      this.successMessage.set(this.translate.instant('entryDetail.relations.profileLinked'));
      await this.loadPersonRelations(this.currentId);
    } catch (error) {
      this.profileLinkError.set(this.describeError(error));
    } finally {
      this.isManagingProfileLinks.set(false);
    }
  }

  async unlinkProfile(profileId?: string): Promise<void> {
    if (!this.showPersonRelations() || !this.currentId || !profileId) {
      return;
    }

    const parsedId = Number(profileId);
    if (!Number.isFinite(parsedId)) {
      return;
    }

    this.isManagingProfileLinks.set(true);
    this.profileLinkError.set(null);
    try {
      await firstValueFrom(this.api.request('DELETE', `/persons/${this.currentId}/profiles/${parsedId}`));
      this.successMessage.set(this.translate.instant('entryDetail.relations.profileUnlinked'));
      await this.loadPersonRelations(this.currentId);
    } catch (error) {
      this.profileLinkError.set(this.describeError(error));
    } finally {
      this.isManagingProfileLinks.set(false);
    }
  }

  private clearMessages(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  private resolveEntryTitle(record: Record<string, unknown>): string | null {
    const type = (this.currentType ?? '').toLowerCase();
    if (type === 'persons') {
      const first = this.extractText(record, ['full_name', 'first_name', 'firstname']);
      const last = this.extractText(record, ['last_name', 'lastname']);
      const composed = [first, last].filter(Boolean).join(' ').trim();
      if (composed.length > 0) {
        return composed;
      }
    }

    const candidates = ['title', 'name', 'label', 'username', 'email'];
    const fallback = this.extractText(record, candidates);
    return fallback ?? null;
  }

  private extractText(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private async loadPersonRelations(personId: string): Promise<void> {
    this.isRelationsLoading.set(true);
    this.relationsError.set(null);
    try {
      const [profilesResult, notesResult, activitiesResult] = await Promise.allSettled([
        firstValueFrom(this.api.request<unknown>('GET', `/persons/${personId}/profiles`)),
        firstValueFrom(this.api.request<unknown>('GET', `/notes/by-person/${personId}`)),
        firstValueFrom(this.api.request<unknown>('GET', '/activities', { params: { person_id: personId, limit: 50 } }))
      ]);

      const errors: string[] = [];

      if (profilesResult.status === 'fulfilled') {
        this.relatedProfiles.set(this.normalizeProfiles(profilesResult.value));
      } else {
        errors.push(this.describeError(profilesResult.reason));
      }

      if (notesResult.status === 'fulfilled') {
        this.relatedNotes.set(this.normalizeNotes(notesResult.value));
      } else {
        errors.push(this.describeError(notesResult.reason));
      }

      if (activitiesResult.status === 'fulfilled') {
        this.relatedActivities.set(this.normalizeActivities(activitiesResult.value));
      } else {
        errors.push(this.describeError(activitiesResult.reason));
      }

      if (errors.length > 0) {
        this.relationsError.set(errors.join(' | '));
      }
    } finally {
      this.isRelationsLoading.set(false);
    }
  }

  private normalizeProfiles(payload: unknown): RelatedEntryItem[] {
    return this.extractItems(payload).map((item) => {
      const record = item as Record<string, unknown>;
      const id = this.extractId(record, ['profile_id', 'id']);
      const label = this.extractText(record, ['display_name', 'username', 'platform']) ?? 'Profile';
      const descriptionParts = [record['platform'], record['status']].filter((value) => typeof value === 'string' && value.trim().length > 0) as string[];
      return {
        id,
        label,
        description: descriptionParts.join(' • '),
        routerLink: id ? ['/entries', 'profiles', id] : undefined,
        type: 'profiles'
      };
    });
  }

  private normalizeNotes(payload: unknown): RelatedEntryItem[] {
    return this.extractItems(payload).map((item) => {
      const record = item as Record<string, unknown>;
      const id = this.extractId(record, ['id']);
      const label = this.extractText(record, ['title']) ?? 'Note';
      const text = this.extractText(record, ['text']);
      const snippet = text && text.length > 80 ? `${text.slice(0, 80)}…` : text;
      return {
        id,
        label,
        description: snippet,
        timestamp: this.extractText(record, ['created_at', 'updated_at']),
        routerLink: id ? ['/entries', 'notes', id] : undefined,
        type: 'notes'
      };
    });
  }

  private normalizeActivities(payload: unknown): RelatedEntryItem[] {
    return this.extractItems(payload).map((item) => {
      const record = item as Record<string, unknown>;
      const id = this.extractId(record, ['id']);
      const label = this.extractText(record, ['activity_type']) ?? 'Activity';
      const description = this.extractText(record, ['item', 'notes']);
      const timestamp = this.extractText(record, ['occurred_at', 'updated_at']);
      return {
        id,
        label,
        description,
        timestamp,
        routerLink: id ? ['/entries', 'activities', id] : undefined,
        type: 'activities'
      };
    });
  }

  private extractItems(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter((item) => typeof item === 'object' && item !== null) as Record<string, unknown>[];
    }

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const items = record['items'];
      if (Array.isArray(items)) {
        return items.filter((item) => typeof item === 'object' && item !== null) as Record<string, unknown>[];
      }
    }

    return [];
  }

  private extractId(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return value.toString();
      }
    }
    return undefined;
  }

  private clearRelations(): void {
    this.relatedProfiles.set([]);
    this.relatedNotes.set([]);
    this.relatedActivities.set([]);
    this.relationsError.set(null);
    this.isRelationsLoading.set(false);
  }
}
