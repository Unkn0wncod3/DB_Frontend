import { CommonModule, DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuditLogRecord, AuditLogService } from '../../core/services/audit-log.service';

interface TimelineEntry extends AuditLogRecord {
  relativeLabel: string;
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
  readonly errorMessage = signal<string | null>(null);
  readonly logs = signal<AuditLogRecord[]>([]);
  readonly total = signal(0);
  readonly nextOffset = signal<number | null>(null);

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
        relativeLabel: this.relativeTime(entry.created_at)
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
    void this.loadLogs();
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
}
