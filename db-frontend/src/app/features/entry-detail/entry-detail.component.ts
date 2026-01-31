import { DatePipe, JsonPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, WritableSignal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { EntryService } from '../../core/services/entry.service';
import { ApiService } from '../../core/services/api.service';

interface EntryFieldConfig {
  key: string;
  label: string;
  multiline: boolean;
  readOnly: boolean;
}

interface RelatedEntryItem {
  id?: string;
  label: string;
  description?: string;
  timestamp?: string;
  routerLink?: string[];
  type: string;
}

@Component({
  selector: 'app-entry-detail',
  standalone: true,
  imports: [NgIf, NgFor, ReactiveFormsModule, JsonPipe, TranslateModule, RouterModule, DatePipe],
  templateUrl: './entry-detail.component.html',
  styleUrl: './entry-detail.component.scss',
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
  private readonly readOnlyKeys = new Set(['id', '_id', 'type', 'createdat', 'updatedat', 'created_at', 'updated_at', 'timestamp', 'occurredat', 'occurred_at']);
  private readonly deleteSecurityKey = 'del1';

  form: FormGroup = this.fb.group({});

  private currentType: string | null = null;
  private currentId: string | null = null;

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

  async delete(): Promise<void> {
    if (!this.currentType || !this.currentId || this.isDeleting()) {
      return;
    }

    const confirmed = window.confirm(this.translate.instant('entryDetail.delete.confirm'));
    if (!confirmed) {
      return;
    }

    const promptMessage = this.translate.instant('entryDetail.delete.passcodePrompt', { key: this.deleteSecurityKey });
    const providedKey = window.prompt(promptMessage);
    if (providedKey == null) {
      return;
    }

    if (providedKey.trim() !== this.deleteSecurityKey) {
      this.errorMessage.set(this.translate.instant('entryDetail.delete.passcodeInvalid'));
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
    const controls: Record<string, FormControl<string>> = {};
    const fieldConfigs: EntryFieldConfig[] = [];

    for (const [key, value] of Object.entries(record)) {
      const stringValue = this.stringifyValue(value);
      const control = this.fb.nonNullable.control(stringValue);
      const readOnly = this.isReadOnlyKey(key);

      if (readOnly) {
        control.disable({ emitEvent: false });
      }

      controls[key] = control;
      fieldConfigs.push({
        key,
        label: this.humanizeKey(key),
        multiline: this.shouldUseTextarea(stringValue),
        readOnly
      });
    }

    this.form = this.fb.nonNullable.group(controls);
    this.fields.set(fieldConfigs);
    this.form.markAsPristine();
  }

  private buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const original = this.entry();

    if (!original) {
      return payload;
    }

    const controls = this.form.controls as Record<string, FormControl<string>>;

    for (const [key, control] of Object.entries(controls)) {
      if (control.disabled) {
        continue;
      }

      const rawValue = control.value ?? '';
      const originalValue = original[key];
      const originalString = this.stringifyValue(originalValue);

      if (originalString === rawValue) {
        continue;
      }

      payload[key] = this.parseValue(rawValue, originalValue);
    }

    return payload;
  }

  private parseValue(value: string, originalValue: unknown): unknown {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return '';
    }

    if (trimmed.toLowerCase() === 'null') {
      return null;
    }

    if (originalValue instanceof Date) {
      const timestamp = Date.parse(trimmed);
      return Number.isNaN(timestamp) ? trimmed : new Date(timestamp).toISOString();
    }

    if (typeof originalValue === 'number') {
      const numeric = Number(trimmed);
      return Number.isFinite(numeric) ? numeric : trimmed;
    }

    if (typeof originalValue === 'boolean') {
      if (trimmed.toLowerCase() === 'true') {
        return true;
      }
      if (trimmed.toLowerCase() === 'false') {
        return false;
      }
    }

    if (this.looksLikeJson(trimmed)) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Fall back to raw trimmed string if parsing fails.
      }
    }

    if (trimmed === 'true' || trimmed === 'false') {
      return trimmed === 'true';
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && trimmed !== '') {
      return numeric;
    }

    return trimmed;
  }

  private looksLikeJson(value: string): boolean {
    if (value.length < 2) {
      return false;
    }

    const first = value[0];
    const last = value[value.length - 1];
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
