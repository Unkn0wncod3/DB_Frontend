import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { GlobalHistoryRecord } from '../../core/models/metadata.models';
import { EntryService } from '../../core/services/entry.service';
import { humanizeKey } from '../../core/utils/schema.utils';

interface HistoryRow {
  historyId: string | number;
  entryId: string | number;
  schemaKey: string;
  schemaName: string;
  entryTitle: string;
  changeType: string;
  changedBy: string;
  changedAt: string;
  comment: string | null;
  visibility: string;
  summary: string;
}

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, DatePipe, RouterLink],
  templateUrl: './audit-logs.component.html',
  styleUrl: './audit-logs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuditLogsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly entryService = inject(EntryService);
  private readonly translate = inject(TranslateService);

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly rows = signal<HistoryRow[]>([]);
  readonly total = signal(0);

  readonly filtersForm = this.fb.nonNullable.group({
    search: ['']
  });

  constructor() {
    void this.loadHistory();
  }

  async refresh(): Promise<void> {
    await this.loadHistory();
  }

  resetSearch(): void {
    this.filtersForm.reset({ search: '' });
    void this.loadHistory();
  }

  trackRow(_index: number, row: HistoryRow): string {
    return `${row.historyId}-${row.entryId}`;
  }

  entryLink(row: HistoryRow): string[] {
    return ['/entries', row.schemaKey, String(row.entryId)];
  }

  private async loadHistory(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const response = await firstValueFrom(
        this.entryService.getGlobalHistory({
          limit: 200,
          offset: 0,
          search: this.filtersForm.controls.search.getRawValue().trim() || undefined
        })
      );

      const rows = (response.items ?? [])
        .map((record) => this.toHistoryRow(record))
        .sort((a, b) => {
          const timeDiff = Date.parse(b.changedAt) - Date.parse(a.changedAt);
          if (!Number.isNaN(timeDiff) && timeDiff !== 0) {
            return timeDiff;
          }
          return Number(b.historyId) - Number(a.historyId);
        });

      this.rows.set(rows);
      this.total.set(response.total ?? rows.length);
    } catch (error) {
      this.rows.set([]);
      this.total.set(0);
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private toHistoryRow(record: GlobalHistoryRecord): HistoryRow {
    return {
      historyId: record.id,
      entryId: record.entry_id,
      schemaKey: record.schema_key,
      schemaName: record.schema_name,
      entryTitle: record.entry_title?.trim() || `${record.schema_name} #${record.entry_id}`,
      changeType: humanizeKey(record.change_type),
      changedBy:
        record.changed_by_username?.trim() ||
        (record.changed_by != null ? `#${record.changed_by}` : '-'),
      changedAt: record.changed_at,
      comment: record.comment?.trim() || null,
      visibility: this.visibilityLabel(record),
      summary: this.diffSummary(record)
    };
  }

  private visibilityLabel(record: GlobalHistoryRecord): string {
    const oldValue = record.old_visibility_level ?? '-';
    const newValue = record.new_visibility_level ?? '-';

    if (oldValue === newValue) {
      return oldValue === '-' ? '-' : humanizeKey(String(newValue));
    }

    return `${humanizeKey(String(oldValue))} -> ${humanizeKey(String(newValue))}`;
  }

  private diffSummary(record: GlobalHistoryRecord): string {
    if (Array.isArray(record.changed_fields) && record.changed_fields.length > 0) {
      return record.changed_fields.map((key) => humanizeKey(key)).join(', ');
    }

    const before = record.old_data_json ?? {};
    const after = record.new_data_json ?? {};
    const changedKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
    );

    if (changedKeys.length === 0 && record.old_visibility_level !== record.new_visibility_level) {
      return this.translate.instant('logsHistory.visibilityOnly');
    }

    if (changedKeys.length === 0) {
      return this.translate.instant('logsHistory.noFieldChanges');
    }

    return changedKeys.map((key) => humanizeKey(key)).join(', ');
  }

  private describeError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('logsHistory.errors.loadFallback');
  }
}
