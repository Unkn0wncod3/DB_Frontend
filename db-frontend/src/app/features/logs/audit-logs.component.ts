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
    const map = new Map<string, number>();
    for (const entry of entries) {
      const action = entry.action || this.translate.instant('logs.table.unknownAction');
      map.set(action, (map.get(action) ?? 0) + 1);
    }
    const max = Math.max(...Array.from(map.values()), 1);
    return Array.from(map.entries()).map(([label, value]) => ({
      label,
      value,
      percent: Math.round((value / max) * 100)
    }));
  });

  readonly resourceStats = computed(() => {
    const entries = this.logs();
    const map = new Map<string, number>();
    for (const entry of entries) {
      const resource = entry.resource || this.translate.instant('logs.table.unknownResource');
      map.set(resource, (map.get(resource) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
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

  private normalizePath(entry: AuditLogRecord): string {
    return entry.path ?? entry.resource ?? this.extractPath(entry.action) ?? '';
  }

  private isNumeric(value: string | undefined): boolean {
    return !!value && /^\d+$/.test(value);
  }

  private humanizeType(value: string): string {
    return value.replace(/[-_]/g, ' ');
  }
}
