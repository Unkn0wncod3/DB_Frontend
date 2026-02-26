import { CommonModule, DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuditLogRecord, AuditLogService } from '../../core/services/audit-log.service';

interface TimelineEntry extends AuditLogRecord {
  relativeLabel: string;
  summary: string;
  detailLine: string | null;
}

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, DatePipe, JsonPipe],
  templateUrl: './audit-logs.component.html',
  styleUrl: './audit-logs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuditLogsComponent {
  private readonly auditLogs = inject(AuditLogService);
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(false);
  readonly isClearing = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly logs = signal<AuditLogRecord[]>([]);
  readonly total = signal(0);
  readonly nextOffset = signal<number | null>(null);
  readonly showClearDialog = signal(false);

  readonly filtersForm = this.fb.nonNullable.group({
    limit: [100, [Validators.min(1), Validators.max(500)]],
    userId: [''],
    action: [''],
    resource: [''],
    search: ['']
  });

  readonly actionStats = computed(() => {
    const entries = this.logs();
    const map = new Map<string, { label: string; count: number }>();
    for (const entry of entries) {
      const descriptor = this.describeActionLabel(entry);
      const bucket = map.get(descriptor.key);
      if (bucket) {
        bucket.count += 1;
      } else {
        map.set(descriptor.key, { label: descriptor.label, count: 1 });
      }
    }
    const items = Array.from(map.values());
    const max = Math.max(...items.map((item) => item.count), 1);
    return items
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((item) => ({
        label: item.label,
        value: item.count,
        percent: Math.round((item.count / max) * 100)
      }));
  });

  readonly userActivityStats = computed(() => {
    const entries = this.logs();
    const map = new Map<string, number>();
    for (const entry of entries) {
      const user = entry.username ?? this.translate.instant('logs.timeline.unknownUser');
      map.set(user, (map.get(user) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([user, value]) => ({
        user,
        value,
        label: this.translate.instant('logs.insights.userLabel', { user, value })
      }));
  });

  readonly timeline = computed<TimelineEntry[]>(() => {
    const search = (this.filtersForm.getRawValue().search ?? '').trim().toLowerCase();
    return this.logs()
      .filter((entry) => this.matchesSearch(entry, search))
      .map((entry) => ({
        ...entry,
        relativeLabel: this.relativeTime(entry.created_at),
        summary: this.describeSummary(entry),
        detailLine: this.describeDetails(entry)
      }));
  });

  constructor() {
    this.filtersForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // keep computed timeline updated; actual fetch happens on submit
      });
    void this.loadLogs();
  }

  async applyFilters(): Promise<void> {
    this.successMessage.set(null);
    await this.loadLogs();
  }

  async loadMore(): Promise<void> {
    const offset = this.nextOffset();
    if (offset == null || this.isLoading()) {
      return;
    }
    await this.loadLogs(offset, true, true);
  }

  resetFilters(): void {
    this.filtersForm.reset({
      limit: 100,
      userId: '',
      action: '',
      resource: '',
      search: ''
    });
    this.successMessage.set(null);
    void this.loadLogs();
  }

  openClearDialog(): void {
    this.showClearDialog.set(true);
  }

  closeClearDialog(): void {
    if (this.isClearing()) {
      return;
    }
    this.showClearDialog.set(false);
  }

  async confirmClear(): Promise<void> {
    if (this.isClearing()) {
      return;
    }
    this.isClearing.set(true);
    this.errorMessage.set(null);
    try {
      await firstValueFrom(this.auditLogs.deleteLogs());
      this.successMessage.set(this.translate.instant('logs.status.cleared'));
      this.showClearDialog.set(false);
      await this.loadLogs();
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isClearing.set(false);
    }
  }

  private async loadLogs(offset = 0, preserveExisting = false, append = false): Promise<void> {
    const limitControl = this.filtersForm.get('limit');
    if (limitControl && limitControl.invalid) {
      limitControl.markAsTouched();
      return;
    }

    const raw = this.filtersForm.getRawValue();
    const params = {
      limit: Number(raw.limit) || 100,
      offset,
      user_id: raw.userId ? Number(raw.userId) : undefined,
      action: raw.action?.trim() || undefined,
      resource: raw.resource?.trim() || undefined
    };

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const response = await firstValueFrom(this.auditLogs.listLogs(params));
      const nextEntries = append ? [...this.logs(), ...response.items] : response.items;
      this.logs.set(nextEntries);
      this.total.set(response.total ?? nextEntries.length);
      this.nextOffset.set(response.next_offset ?? null);
    } catch (error) {
      if (!preserveExisting) {
        this.logs.set([]);
        this.total.set(0);
      }
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private matchesSearch(entry: AuditLogRecord, search: string): boolean {
    if (!search) {
      return true;
    }
    const haystack = [
      entry.username ?? '',
      entry.action ?? '',
      entry.resource ?? '',
      JSON.stringify(entry.metadata ?? {})
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  }

  private relativeTime(timestamp: string): string {
    const value = Date.parse(timestamp);
    if (Number.isNaN(value)) {
      return timestamp;
    }
    const now = Date.now();
    const diff = now - value;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) {
      return this.translate.instant('logs.timeline.justNow');
    }
    if (minutes < 60) {
      return this.translate.instant('logs.timeline.minutesAgo', { value: minutes });
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return this.translate.instant('logs.timeline.hoursAgo', { value: hours });
    }
    const days = Math.floor(hours / 24);
    return this.translate.instant('logs.timeline.daysAgo', { value: days });
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('logs.status.genericError');
  }

  private describeSummary(entry: AuditLogRecord): string {
    const metadataSummary = this.describeMetadataEventSummary(entry);
    if (metadataSummary) {
      return metadataSummary;
    }
    const user = entry.username ?? this.translate.instant('logs.timeline.unknownUser');
    const resource = this.describeResourceLabel(entry);
    const verbKey = this.resolveVerbKey(entry, entry.method ?? this.extractMethod(entry.action));
    if (verbKey === 'login') {
      const outcome = this.describeLoginOutcome(entry);
      const loginKey = outcome === 'success' ? 'loginSuccess' : outcome === 'failure' ? 'loginFailure' : 'login';
      return this.translate.instant(`logs.timeline.summary.${loginKey}`, { user });
    }
    return this.translate.instant(`logs.timeline.summary.${verbKey}`, {
      user,
      resource
    });
  }

  private describeDetails(entry: AuditLogRecord): string | null {
    const parts: string[] = [];
    if (entry.role) {
      parts.push(this.translate.instant('logs.timeline.details.role', { value: entry.role }));
    }
    const resourcePath = this.normalizePath(entry);
    if (resourcePath) {
      parts.push(this.translate.instant('logs.timeline.details.resource', { value: resourcePath }));
    }
    if (entry.status_code != null) {
      parts.push(this.translate.instant('logs.timeline.details.status', { value: entry.status_code }));
    }
    if (entry.ip_address) {
      parts.push(this.translate.instant('logs.timeline.details.ip', { value: entry.ip_address }));
    }
    const query = this.metadataString(entry, 'query_string');
    if (query) {
      parts.push(this.translate.instant('logs.timeline.details.query', { value: query }));
    }
    return parts.length > 0 ? parts.join(' • ') : null;
  }

  private resolveVerbKey(entry: AuditLogRecord, method: string | null): string {
    const action = entry.action?.toLowerCase() ?? '';
    if (action.includes('login') || action.includes('auth/login')) {
      return 'login';
    }
    const normalized = method?.toUpperCase();
    if (normalized === 'DELETE') {
      return 'delete';
    }
    if (normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH') {
      return 'write';
    }
    if (normalized === 'GET') {
      return 'read';
    }
    return 'generic';
  }

  private extractMethod(action: string | undefined): string | null {
    if (!action) {
      return null;
    }
    const parts = action.trim().split(/\s+/);
    if (parts.length > 1 && parts[0].length <= 10) {
      return parts[0];
    }
    return null;
  }

  private describeLoginOutcome(entry: AuditLogRecord): 'success' | 'failure' | null {
    const outcome = this.metadataString(entry, 'outcome');
    if (outcome) {
      if (outcome.toLowerCase().includes('success')) {
        return 'success';
      }
      if (outcome.toLowerCase().includes('fail')) {
        return 'failure';
      }
    }
    if (entry.status_code != null) {
      return entry.status_code >= 400 ? 'failure' : 'success';
    }
    return null;
  }

  private metadataString(entry: AuditLogRecord, key: string): string | null {
    if (!entry.metadata) {
      return null;
    }
    const value = entry.metadata[key];
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  }

  private extractPath(action: string | undefined): string | null {
    if (!action) {
      return null;
    }
    const spaceIndex = action.indexOf(' ');
    if (spaceIndex >= 0) {
      return action.slice(spaceIndex + 1).trim();
    }
    return null;
  }

  private describeResourceLabel(entry: AuditLogRecord): string {
    const path = this.normalizePath(entry);
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) {
      return this.translate.instant('logs.timeline.resources.unknown');
    }
    const [root, second, third] = segments;
    const secondIsId = this.isNumeric(second);
    switch (root) {
      case 'persons': {
        if (!second) {
          return this.translate.instant('logs.timeline.resources.personList');
        }
        if (secondIsId) {
          if (!third) {
            return this.translate.instant('logs.timeline.resources.personDetail', { id: second });
          }
          if (third === 'profiles') {
            return this.translate.instant('logs.timeline.resources.personProfiles', { id: second });
          }
          if (third === 'notes') {
            return this.translate.instant('logs.timeline.resources.personNotes', { id: second });
          }
          if (third === 'activities') {
            return this.translate.instant('logs.timeline.resources.personActivities', { id: second });
          }
        }
        break;
      }
      case 'notes': {
        if (second === 'by-person' && third && this.isNumeric(third)) {
          return this.translate.instant('logs.timeline.resources.notesByPerson', { id: third });
        }
        if (!second) {
          return this.translate.instant('logs.timeline.resources.noteList');
        }
        if (this.isNumeric(second)) {
          return this.translate.instant('logs.timeline.resources.noteDetail', { id: second });
        }
        break;
      }
      case 'profiles': {
        if (!second) {
          return this.translate.instant('logs.timeline.resources.profileList');
        }
        if (this.isNumeric(second)) {
          return this.translate.instant('logs.timeline.resources.profileDetail', { id: second });
        }
        break;
      }
      case 'activities':
        return this.translate.instant('logs.timeline.resources.activities');
      case 'users': {
        if (!second) {
          return this.translate.instant('logs.timeline.resources.users');
        }
        if (this.isNumeric(second)) {
          return this.translate.instant('logs.timeline.resources.userDetail', { id: second });
        }
        break;
      }
      case 'audit':
        if (second === 'logs') {
          return this.translate.instant('logs.timeline.resources.auditLogs');
        }
        break;
      case 'stats':
        if (second === 'overview') {
          return this.translate.instant('logs.timeline.resources.statsOverview');
        }
        break;
      case 'auth':
        if (second === 'me') {
          return this.translate.instant('logs.timeline.resources.authMe');
        }
        if (second === 'login') {
          return this.translate.instant('logs.timeline.resources.authLogin');
        }
        break;
      case 'platforms': {
        if (!second) {
          return this.translate.instant('logs.timeline.resources.platforms');
        }
        if (this.isNumeric(second)) {
          return this.translate.instant('logs.timeline.resources.platformDetail', { id: second });
        }
        break;
      }
      case 'entries': {
        const type = second;
        if (type) {
          const readableType = this.humanizeType(type);
          if (!third) {
            return this.translate.instant('logs.timeline.resources.entriesList', { type: readableType });
          }
          return this.translate.instant('logs.timeline.resources.entriesDetail', {
            type: readableType,
            id: third
          });
        }
        break;
      }
    }
    return this.translate.instant('logs.timeline.resources.generic', { value: path });
  }

  private describeActionLabel(entry: AuditLogRecord): { key: string; label: string } {
    const verbKey = this.resolveVerbKey(entry, entry.method ?? this.extractMethod(entry.action));
    const resource = this.describeResourceLabel(entry);
    const normalizedPath = this.normalizePath(entry);
    const label = this.translate.instant(`logs.insights.actionLabels.${verbKey}`, { resource });
    const key = `${verbKey}:${normalizedPath || 'root'}`;
    return { key, label };
  }

  private normalizePath(entry: AuditLogRecord): string {
    return entry.path ?? entry.resource ?? this.extractPath(entry.action) ?? '';
  }

  private isNumeric(value: string | undefined): boolean {
    return !!value && /^\d+$/.test(value);
  }

  private humanizeType(value: string): string {
    return value.replace(/[-_]/g, ' ');
  }

  private describeMetadataEventSummary(entry: AuditLogRecord): string | null {
    const event = this.metadataString(entry, 'event');
    if (!event) {
      return null;
    }
    const actor = entry.username ?? this.translate.instant('logs.timeline.unknownUser');
    switch (event) {
      case 'audit_logs_cleared':
        return this.translate.instant('logs.events.audit_logs_cleared', { actor });
      case 'user_created': {
        const target = this.buildReference({
          name: this.metadataString(entry, 'target_username'),
          id: this.metadataString(entry, 'target_user_id'),
          fallbackKey: 'logs.events.targets.user'
        });
        return this.translate.instant('logs.events.user_created', { actor, target });
      }
      case 'user_updated': {
        const target = this.buildReference({
          name: this.metadataString(entry, 'target_username'),
          id: this.metadataString(entry, 'target_user_id'),
          fallbackKey: 'logs.events.targets.user'
        });
        const fields = this.describeChangedFields(entry, 'changed_fields');
        return this.translate.instant('logs.events.user_updated', { actor, target, fields });
      }
      case 'user_status_changed': {
        const target = this.buildReference({
          name: this.metadataString(entry, 'target_username'),
          id: this.metadataString(entry, 'target_user_id'),
          fallbackKey: 'logs.events.targets.user'
        });
        const isActive = this.metadataBoolean(entry, 'is_active');
        const state = this.translate.instant(
          isActive ? 'logs.events.states.activated' : 'logs.events.states.deactivated'
        );
        return this.translate.instant('logs.events.user_status_changed', { actor, target, state });
      }
      case 'user_deleted': {
        const target = this.buildReference({
          name: this.metadataString(entry, 'target_username'),
          id: this.metadataString(entry, 'target_user_id'),
          fallbackKey: 'logs.events.targets.user'
        });
        return this.translate.instant('logs.events.user_deleted', { actor, target });
      }
      case 'person_created': {
        const target = this.buildReference({
          name: this.composePersonName(entry),
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        const visibility = this.describeVisibility(this.metadataString(entry, 'visibility'));
        return this.translate.instant('logs.events.person_created', { actor, target, visibility });
      }
      case 'person_updated': {
        const target = this.buildReference({
          name: this.composePersonName(entry),
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        const fields = this.describeChangedFields(entry, 'changed_fields');
        return this.translate.instant('logs.events.person_updated', { actor, target, fields });
      }
      case 'person_deleted': {
        const target = this.buildReference({
          name: this.composePersonName(entry),
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        return this.translate.instant('logs.events.person_deleted', { actor, target });
      }
      case 'profile_created': {
        const target = this.buildReference({
          name: this.metadataString(entry, 'username'),
          id: this.metadataString(entry, 'profile_id'),
          fallbackKey: 'logs.events.targets.profile'
        });
        const platform = this.metadataString(entry, 'platform_id');
        return this.translate.instant('logs.events.profile_created', { actor, target, platform });
      }
      case 'profile_updated': {
        const target = this.buildReference({
          name: this.metadataString(entry, 'username'),
          id: this.metadataString(entry, 'profile_id'),
          fallbackKey: 'logs.events.targets.profile'
        });
        const fields = this.describeChangedFields(entry, 'changed_fields');
        return this.translate.instant('logs.events.profile_updated', { actor, target, fields });
      }
      case 'profile_deleted': {
        const target = this.buildReference({
          name: this.metadataString(entry, 'username'),
          id: this.metadataString(entry, 'profile_id'),
          fallbackKey: 'logs.events.targets.profile'
        });
        const platform = this.metadataString(entry, 'platform_id');
        return this.translate.instant('logs.events.profile_deleted', { actor, target, platform });
      }
      case 'profile_linked': {
        const person = this.buildReference({
          name: this.composePersonName(entry),
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        const profile = this.buildReference({
          name: this.metadataString(entry, 'username'),
          id: this.metadataString(entry, 'profile_id'),
          fallbackKey: 'logs.events.targets.profile'
        });
        const noteValue = this.metadataString(entry, 'note');
        const note = noteValue ? this.translate.instant('logs.events.noteSuffix', { value: noteValue }) : '';
        return this.translate.instant('logs.events.profile_linked', { actor, person, profile, note });
      }
      case 'profile_unlinked': {
        const person = this.buildReference({
          name: this.composePersonName(entry),
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        const profile = this.buildReference({
          name: this.metadataString(entry, 'username'),
          id: this.metadataString(entry, 'profile_id'),
          fallbackKey: 'logs.events.targets.profile'
        });
        return this.translate.instant('logs.events.profile_unlinked', { actor, person, profile });
      }
      case 'note_created': {
        const note = this.buildReference({
          id: this.metadataString(entry, 'note_id'),
          fallbackKey: 'logs.events.targets.note'
        });
        const person = this.buildReference({
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        const pinnedState = this.describePinnedState(this.metadataBoolean(entry, 'pinned'));
        return this.translate.instant('logs.events.note_created', { actor, note, person, pinned: pinnedState });
      }
      case 'note_updated': {
        const note = this.buildReference({
          id: this.metadataString(entry, 'note_id'),
          fallbackKey: 'logs.events.targets.note'
        });
        const fields = this.describeChangedFields(entry, 'changed_fields');
        const pinnedState = this.describePinnedState(this.metadataBoolean(entry, 'pinned'));
        return this.translate.instant('logs.events.note_updated', { actor, note, fields, pinned: pinnedState });
      }
      case 'note_deleted': {
        const note = this.buildReference({
          id: this.metadataString(entry, 'note_id'),
          fallbackKey: 'logs.events.targets.note'
        });
        const person = this.buildReference({
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        return this.translate.instant('logs.events.note_deleted', { actor, note, person });
      }
      case 'activity_created': {
        const activity = this.buildReference({
          id: this.metadataString(entry, 'activity_id'),
          fallbackKey: 'logs.events.targets.activity'
        });
        const person = this.buildReference({
          id: this.metadataString(entry, 'person_id'),
          fallbackKey: 'logs.events.targets.person'
        });
        const type = this.metadataString(entry, 'activity_type');
        return this.translate.instant('logs.events.activity_created', { actor, activity, person, type: type ?? '' });
      }
      case 'activity_updated': {
        const activity = this.buildReference({
          id: this.metadataString(entry, 'activity_id'),
          fallbackKey: 'logs.events.targets.activity'
        });
        const fields = this.describeChangedFields(entry, 'changed_fields');
        return this.translate.instant('logs.events.activity_updated', { actor, activity, fields });
      }
      case 'activity_deleted': {
        const activity = this.buildReference({
          id: this.metadataString(entry, 'activity_id'),
          fallbackKey: 'logs.events.targets.activity'
        });
        const type = this.metadataString(entry, 'activity_type');
        return this.translate.instant('logs.events.activity_deleted', { actor, activity, type: type ?? '' });
      }
      default:
        return null;
    }
  }

  private describeChangedFields(entry: AuditLogRecord, key: string): string {
    const fields = this.metadataList(entry, key);
    if (fields.length === 0) {
      return this.translate.instant('logs.events.fields.unknown');
    }
    return fields.join(', ');
  }

  private describePinnedState(state: boolean | null): string {
    if (state === null) {
      return '';
    }
    const label = this.translate.instant(state ? 'logs.events.states.pinned' : 'logs.events.states.unpinned');
    return ` (${label})`;
  }

  private describeVisibility(value: string | null): string {
    if (!value) {
      return this.translate.instant('logs.events.visibility.unknown');
    }
    const key = `entryVisibility.options.${value}`;
    const translated = this.translate.instant(key);
    return translated === key ? value : translated;
  }

  private composePersonName(entry: AuditLogRecord): string | null {
    const first = this.metadataString(entry, 'first_name');
    const last = this.metadataString(entry, 'last_name');
    const composed = [first, last].filter(Boolean).join(' ').trim();
    return composed.length > 0 ? composed : null;
  }

  private buildReference(options: { name?: string | null; id?: string | null; fallbackKey: string }): string {
    const name = options.name?.trim();
    const id = options.id?.toString().trim();
    if (name && id) {
      return `${name} (#${id})`;
    }
    if (name) {
      return name;
    }
    if (id) {
      return `#${id}`;
    }
    return this.translate.instant(options.fallbackKey);
  }

  private metadataBoolean(entry: AuditLogRecord, key: string): boolean | null {
    if (!entry.metadata || !(key in entry.metadata)) {
      return null;
    }
    const value = entry.metadata[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }
    return null;
  }

  private metadataList(entry: AuditLogRecord, key: string): string[] {
    if (!entry.metadata) {
      return [];
    }
    const value = entry.metadata[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
    }
    return [];
  }
}
