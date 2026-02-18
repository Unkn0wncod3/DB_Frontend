import { DatePipe, JsonPipe, NgClass, NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal, WritableSignal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { EntryRecord, EntryService } from '../../core/services/entry.service';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ValueDropdownComponent, ValueDropdownOption } from '../../shared/components/value-dropdown/value-dropdown.component';
import { EntryFieldConfig, EntryFieldInputType } from './entry-detail.types';
import { EntryDetailFieldGridComponent } from './components/entry-detail-field-grid/entry-detail-field-grid.component';
import { EntryDetailRelationsComponent } from './components/entry-detail-relations/entry-detail-relations.component';
import { EntryDetailDeleteDialogComponent } from './components/entry-detail-delete-dialog/entry-detail-delete-dialog.component';
import { EntryDetailRawViewComponent } from './components/entry-detail-raw-view/entry-detail-raw-view.component';
import { DEFAULT_VISIBILITY_LEVEL, VisibilityLevel, coerceVisibilityLevel } from '../../shared/types/visibility-level.type';
import { PersonDossierComponent } from './components/person-dossier/person-dossier.component';

@Component({
  selector: 'app-entry-detail',
  standalone: true,
  imports: [
    NgIf,
    NgClass,
    NgFor,
    NgSwitch,
    NgSwitchCase,
    NgSwitchDefault,
    ReactiveFormsModule,
    JsonPipe,
    TranslateModule,
    RouterModule,
    DatePipe,
    EntryDetailFieldGridComponent,
    EntryDetailRelationsComponent,
    EntryDetailDeleteDialogComponent,
    EntryDetailRawViewComponent,
    ValueDropdownComponent,
    PersonDossierComponent
  ],
  templateUrl: './entry-detail.component.html',
  styleUrls: ['./entry-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly entryService = inject(EntryService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly isDeleting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly entry = signal<EntryRecord | null>(null);
  readonly fields: WritableSignal<EntryFieldConfig[]> = signal([]);
  readonly entryTitle = signal<string | null>(null);
  readonly booleanOptions = signal<ValueDropdownOption[]>([]);
  readonly visibilityOptions = signal<ValueDropdownOption[]>([]);
  readonly visibilityControl = this.fb.nonNullable.control<VisibilityLevel>(DEFAULT_VISIBILITY_LEVEL);
  private readonly readOnlyKeys = new Set(['id', '_id', 'type', 'createdat', 'updatedat', 'created_at', 'updated_at', 'timestamp', 'occurredat', 'occurred_at']);
  private readonly dateFieldHints = new Map<string, 'date' | 'datetime'>([
    ['date_of_birth', 'date'],
    ['dob', 'date'],
    ['birthdate', 'date'],
    ['last_seen_at', 'datetime'],
    ['last_seen', 'datetime'],
    ['last_service_at', 'datetime'],
    ['occurred_at', 'datetime'],
    ['occurredat', 'datetime'],
    ['created_at', 'datetime'],
    ['createdat', 'datetime'],
    ['updated_at', 'datetime'],
    ['updatedat', 'datetime'],
    ['timestamp', 'datetime']
  ]);
  private readonly relationsLayoutStorageKey = 'entryDetailRelationsLayout';
  readonly relationsLayout = signal<'side' | 'stacked'>(this.loadRelationsLayout());
  private readonly rawViewStorageKey = 'entryDetailRawView';
  readonly showRawView = signal(this.loadRawViewPreference());
  readonly deleteSecurityKey = 'del1';
  readonly isDeleteDialogOpen = signal(false);
  readonly personView = signal<'details' | 'dossier'>('details');

  form: FormGroup = this.fb.group({});

  private currentType: string | null = null;
  private currentId: string | null = null;
  private fieldConfigMap = new Map<string, EntryFieldConfig>();
  private currentVisibilityLevel: VisibilityLevel = DEFAULT_VISIBILITY_LEVEL;
  private readonly selectFieldKeys = new Set(['gender', 'status', 'risk_level', 'energy_type', 'vehicle_type']);

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
      if (!this.canShowDossierToggle()) {
        this.personView.set('details');
      }
      void this.loadEntry();
    });

    this.booleanOptions.set(this.buildBooleanOptions());
    this.visibilityOptions.set(this.buildVisibilityOptions());
    this.translate.onLangChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.booleanOptions.set(this.buildBooleanOptions());
      this.visibilityOptions.set(this.buildVisibilityOptions());
      this.refreshSelectFieldOptions();
    });

    this.updateVisibilityControlState(DEFAULT_VISIBILITY_LEVEL);
  }

  setPersonView(view: 'details' | 'dossier'): void {
    if (view === 'dossier' && !this.canShowDossierToggle()) {
      this.personView.set('details');
      return;
    }
    this.personView.set(view);
  }

  isDossierView(): boolean {
    return this.personView() === 'dossier';
  }

  canShowDossierToggle(): boolean {
    return this.showPersonRelations() && !!this.currentId;
  }

  openDeleteDialog(): void {
    if (!this.canDeleteEntries() || !this.currentType || !this.currentId) {
      return;
    }
    this.isDeleteDialogOpen.set(true);
  }

  closeDeleteDialog(): void {
    if (this.isDeleting()) {
      return;
    }
    this.isDeleteDialogOpen.set(false);
  }

  async handleDeleteConfirmed(): Promise<void> {
    await this.performDelete();
    this.closeDeleteDialog();
  }

  async refresh(): Promise<void> {
    await this.loadEntry(true);
  }

  async save(): Promise<void> {
    if (!this.canEditEntries() || !this.currentType || !this.currentId || this.form.invalid) {
      return;
    }

    const payload = this.buildPayload();
    this.appendVisibilityToPayload(payload);

    if (Object.keys(payload).length === 0) {
      this.successMessage.set(this.translate.instant('entryDetail.status.noChanges'));
      this.form.markAsPristine();
      this.visibilityControl.markAsPristine();
      return;
    }

    this.clearMessages();
    this.isSaving.set(true);

    try {
      const updated = await firstValueFrom(
        this.entryService.updateEntry(this.currentType, this.currentId, payload)
      );

      if (updated && typeof updated === 'object') {
        this.entry.set(updated as EntryRecord);
        this.rebuildForm(updated as EntryRecord);
        this.updateVisibilityControlState(this.extractVisibility(updated as EntryRecord));
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
    if (!this.canDeleteEntries() || !this.currentType || !this.currentId || this.isDeleting()) {
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

  hasChanges(): boolean {
    return (this.form.dirty || this.visibilityControl.dirty) && !this.isSaving();
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
      this.updateVisibilityControlState(this.extractVisibility(record));
    } catch (error) {
      if (this.isHiddenEntryError(error)) {
        this.errorMessage.set(this.translate.instant('entryDetail.errors.hiddenFromUser'));
      } else {
        this.errorMessage.set(this.translate.instant('entryDetail.errors.loadFailed', {
          message: this.describeError(error)
        }));
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  private rebuildForm(record: EntryRecord): void {
    const controls: Record<string, FormControl<string | number | boolean | null>> = {};
    const fieldConfigs: EntryFieldConfig[] = [];

    for (const [key, value] of Object.entries(record)) {
      if (this.shouldHideField(key)) {
        continue;
      }

      const inputType = this.detectFieldType(key, value);
      const selectOptions = inputType === 'select' ? this.buildSelectOptionsForKey(key) : null;
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
        dateVariant,
        options: selectOptions ?? undefined
      });
    }

    this.form = this.fb.nonNullable.group(controls);
    if (!this.canEditEntries()) {
      this.form.disable({ emitEvent: false });
    }
    this.fields.set(fieldConfigs);
    this.fieldConfigMap = new Map(fieldConfigs.map((config) => [config.key, config]));
    this.form.markAsPristine();
  }

  private shouldHideField(key: string): boolean {
    const normalized = key.toLowerCase();

    if (normalized === 'id' || normalized === '_id') {
      return true;
    }

    if (normalized === 'metadata' || normalized === 'tags') {
      return true;
    }

    if (normalized === 'created_at' || normalized === 'updated_at') {
      return true;
    }

    return this.isVisibilityKey(normalized);
  }

  private isVisibilityKey(key: string): boolean {
    return key === 'visibility_level';
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

  private appendVisibilityToPayload(payload: Record<string, unknown>): void {
    if (!this.canEditVisibility()) {
      return;
    }

    const desired = this.visibilityControl.getRawValue() ?? DEFAULT_VISIBILITY_LEVEL;
    if (desired !== this.currentVisibilityLevel) {
      payload['visibility_level'] = desired;
    }
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
    if (this.isSelectFieldKey(normalizedKey)) {
      return 'select';
    }

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

    if (value instanceof Date) {
      return 'datetime';
    }

    return null;
  }

  private dateVariantFromKey(key: string): 'date' | 'datetime' | null {
    const hint = this.dateFieldHints.get(key);
    if (hint) {
      return hint;
    }

    if (key.endsWith('_date') || key.includes('date_of') || key.endsWith('dob')) {
      return 'date';
    }

    if (key.endsWith('_at') || key.endsWith('_timestamp') || key.endsWith('timestamp') || key.endsWith('_time') || key.includes('last_seen') || key.includes('occurred')) {
      return 'datetime';
    }

    return null;
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

  private refreshSelectFieldOptions(): void {
    const currentFields = this.fields();
    if (!currentFields || currentFields.length === 0) {
      return;
    }

    const updatedFields = currentFields.map<EntryFieldConfig>((config) => {
      if (!this.isSelectFieldKey(config.key)) {
        return config;
      }
      return {
        ...config,
        inputType: 'select',
        options: this.buildSelectOptionsForKey(config.key) ?? []
      };
    });

    this.fields.set(updatedFields);
    this.fieldConfigMap = new Map(updatedFields.map((config) => [config.key, config]));
  }

  private buildVisibilityOptions(): ValueDropdownOption[] {
    return [
      { label: this.translate.instant('entryVisibility.options.user'), value: 'user' },
      { label: this.translate.instant('entryVisibility.options.admin'), value: 'admin' }
    ];
  }

  private buildSelectOptionsForKey(key: string): ValueDropdownOption[] | null {
    const normalized = key.toLowerCase();
    switch (normalized) {
      case 'gender':
        return [
          this.selectOption('entryDetail.selectOptions.gender.unspecified', 'Unspecified'),
          this.selectOption('entryDetail.selectOptions.gender.female', 'Female'),
          this.selectOption('entryDetail.selectOptions.gender.male', 'Male'),
          this.selectOption('entryDetail.selectOptions.gender.nonBinary', 'Non-binary'),
          this.selectOption('entryDetail.selectOptions.gender.other', 'Other')
        ];
      case 'status':
        return [
          this.selectOption('entryDetail.selectOptions.status.active', 'active'),
          this.selectOption('entryDetail.selectOptions.status.inactive', 'inactive'),
          this.selectOption('entryDetail.selectOptions.status.suspended', 'suspended'),
          this.selectOption('entryDetail.selectOptions.status.archived', 'archived'),
          this.selectOption('entryDetail.selectOptions.status.pending', 'pending')
        ];
      case 'risk_level':
        return [
          this.selectOption('entryDetail.selectOptions.risk.low', 'Low'),
          this.selectOption('entryDetail.selectOptions.risk.medium', 'Medium'),
          this.selectOption('entryDetail.selectOptions.risk.high', 'High'),
          this.selectOption('entryDetail.selectOptions.risk.critical', 'Critical'),
          this.selectOption('entryDetail.selectOptions.risk.unknown', 'N/A')
        ];
      case 'energy_type':
        return [
          this.selectOption('entryDetail.selectOptions.energy.gasoline', 'gasoline'),
          this.selectOption('entryDetail.selectOptions.energy.diesel', 'diesel'),
          this.selectOption('entryDetail.selectOptions.energy.hybrid', 'hybrid'),
          this.selectOption('entryDetail.selectOptions.energy.electric', 'electric'),
          this.selectOption('entryDetail.selectOptions.energy.hydrogen', 'hydrogen'),
          this.selectOption('entryDetail.selectOptions.energy.other', 'other')
        ];
      case 'vehicle_type':
        return [
          this.selectOption('entryDetail.selectOptions.vehicleType.sedan', 'sedan'),
          this.selectOption('entryDetail.selectOptions.vehicleType.suv', 'suv'),
          this.selectOption('entryDetail.selectOptions.vehicleType.truck', 'truck'),
          this.selectOption('entryDetail.selectOptions.vehicleType.motorcycle', 'motorcycle'),
          this.selectOption('entryDetail.selectOptions.vehicleType.van', 'van'),
          this.selectOption('entryDetail.selectOptions.vehicleType.bus', 'bus'),
          this.selectOption('entryDetail.selectOptions.vehicleType.other', 'other')
        ];
      default:
        return null;
    }
  }

  private selectOption(labelKey: string, value: string): ValueDropdownOption {
    return {
      label: this.translate.instant(labelKey),
      value
    };
  }

  private isSelectFieldKey(key: string): boolean {
    return this.selectFieldKeys.has(key.toLowerCase());
  }

  private extractVisibility(record: EntryRecord | null): VisibilityLevel {
    if (!record) {
      return DEFAULT_VISIBILITY_LEVEL;
    }
    return coerceVisibilityLevel(record.visibility_level);
  }

  private updateVisibilityControlState(level: VisibilityLevel): void {
    this.currentVisibilityLevel = level;
    this.visibilityControl.setValue(level, { emitEvent: false });
    if (this.canEditVisibility()) {
      this.visibilityControl.enable({ emitEvent: false });
    } else {
      this.visibilityControl.disable({ emitEvent: false });
    }
    this.visibilityControl.markAsPristine();
  }

  canEditVisibility(): boolean {
    return this.auth.canManageVisibility();
  }

  get visibilityLevel(): VisibilityLevel {
    return this.currentVisibilityLevel;
  }

  visibilityBadgeClasses(): Record<string, boolean> {
    return {
      'visibility-badge': true,
      'visibility-badge--admin': this.currentVisibilityLevel === 'admin',
      'visibility-badge--user': this.currentVisibilityLevel === 'user'
    };
  }

  visibilityBadgeLabelKey(): string {
    return `entryVisibility.badge.${this.currentVisibilityLevel}`;
  }

  private humanizeKey(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private ensureRecord(payload: unknown): EntryRecord {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as EntryRecord;
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

  private isHiddenEntryError(error: unknown): boolean {
    return (
      !this.auth.canViewAdminVisibility() &&
      error instanceof HttpErrorResponse &&
      (error.status === 403 || error.status === 404)
    );
  }

  get entryType(): string | null {
    return this.currentType;
  }

  get entryId(): string | null {
    return this.currentId;
  }

  get createdTimestamp(): string | number | Date | null {
    return this.normalizeTimestamp(this.entry()?.['created_at']);
  }

  get updatedTimestamp(): string | number | Date | null {
    return this.normalizeTimestamp(this.entry()?.['updated_at']);
  }

  private normalizeTimestamp(value: unknown): string | number | Date | null {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    return null;
  }

  canEditEntries(): boolean {
    return this.auth.canEditEntries();
  }

  canDeleteEntries(): boolean {
    return this.auth.canDeleteEntries();
  }

  showPersonRelations(): boolean {
    return (this.currentType ?? '').toLowerCase() === 'persons';
  }

  onRelationsLayoutChange(value: string): void {
    const layout = value === 'stacked' ? 'stacked' : 'side';
    this.setRelationsLayout(layout);
  }

  toggleRawView(): void {
    const next = !this.showRawView();
    this.showRawView.set(next);
    this.persistRawViewPreference(next);
  }

  private setRelationsLayout(layout: 'side' | 'stacked'): void {
    this.relationsLayout.set(layout);
    this.persistRelationsLayout(layout);
  }

  private loadRelationsLayout(): 'side' | 'stacked' {
    const storage = this.getPreferenceStorage();
    if (!storage) {
      return 'side';
    }

    const stored = storage.getItem(this.relationsLayoutStorageKey);
    return stored === 'stacked' ? 'stacked' : 'side';
  }

  private persistRelationsLayout(layout: 'side' | 'stacked'): void {
    const storage = this.getPreferenceStorage();
    if (!storage) {
      return;
    }

    try {
      storage.setItem(this.relationsLayoutStorageKey, layout);
    } catch {
      // ignore persistence errors
    }
  }

  private loadRawViewPreference(): boolean {
    const storage = this.getPreferenceStorage();
    if (!storage) {
      return true;
    }

    const stored = storage.getItem(this.rawViewStorageKey);
    if (stored === 'hidden') {
      return false;
    }
    if (stored === 'visible') {
      return true;
    }
    return true;
  }

  private persistRawViewPreference(visible: boolean): void {
    const storage = this.getPreferenceStorage();
    if (!storage) {
      return;
    }

    try {
      storage.setItem(this.rawViewStorageKey, visible ? 'visible' : 'hidden');
    } catch {
      // ignore persistence errors
    }
  }

  private getPreferenceStorage(): Storage | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      return window.localStorage;
    } catch {
      return null;
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
}
