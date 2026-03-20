import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { EntryHistoryRecord, EntryRecordWithAccess } from '../../core/models/metadata.models';
import { EntryService } from '../../core/services/entry.service';
import { SchemaService } from '../../core/services/schema.service';
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
  private readonly schemaService = inject(SchemaService);
  private readonly entryService = inject(EntryService);
  private readonly translate = inject(TranslateService);

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly rows = signal<HistoryRow[]>([]);

  readonly filtersForm = this.fb.nonNullable.group({
    search: ['']
  });

  readonly filteredRows = computed(() => {
    const search = this.filtersForm.controls.search.getRawValue().trim().toLowerCase();
    if (!search) {
      return this.rows();
    }

    return this.rows().filter((row) =>
      [
        row.schemaName,
        row.schemaKey,
        row.entryTitle,
        row.entryId,
        row.changeType,
        row.changedBy,
        row.comment ?? '',
        row.visibility,
        row.summary
      ]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  });

  constructor() {
    void this.loadHistory();
  }

  async refresh(): Promise<void> {
    await this.loadHistory();
  }

  resetSearch(): void {
    this.filtersForm.reset({ search: '' });
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
      const schemas = await firstValueFrom(this.schemaService.loadSchemas(true, true));
      const schemaEntries = await Promise.all(
        schemas.map(async (schema) => {
          const response = await firstValueFrom(this.schemaService.getSchemaEntries(schema.id));
          return {
            schemaId: schema.id,
            schemaKey: schema.key,
            schemaName: schema.name,
            entries: response.entries ?? []
          };
        })
      );

      const historyGroups = await Promise.all(
        schemaEntries.flatMap((group) =>
          group.entries.map(async (entry) => ({
            schemaKey: group.schemaKey,
            schemaName: group.schemaName,
            entry,
            history: await this.safeLoadEntryHistory(entry)
          }))
        )
      );

      const rows = historyGroups
        .flatMap((group) =>
          group.history.map((record) => this.toHistoryRow(group.schemaKey, group.schemaName, group.entry, record))
        )
        .sort((a, b) => {
          const timeDiff = Date.parse(b.changedAt) - Date.parse(a.changedAt);
          if (!Number.isNaN(timeDiff) && timeDiff !== 0) {
            return timeDiff;
          }
          return Number(b.historyId) - Number(a.historyId);
        });

      this.rows.set(rows);
    } catch (error) {
      this.rows.set([]);
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private async safeLoadEntryHistory(entry: EntryRecordWithAccess): Promise<EntryHistoryRecord[]> {
    try {
      return await firstValueFrom(this.entryService.getHistory(entry.id));
    } catch {
      return [];
    }
  }

  private toHistoryRow(
    schemaKey: string,
    schemaName: string,
    entry: EntryRecordWithAccess,
    record: EntryHistoryRecord
  ): HistoryRow {
    return {
      historyId: record.id,
      entryId: entry.id,
      schemaKey,
      schemaName,
      entryTitle: entry.title?.trim() || `${schemaName} #${entry.id}`,
      changeType: humanizeKey(record.change_type),
      changedBy: record.changed_by != null ? `#${record.changed_by}` : '-',
      changedAt: record.changed_at,
      comment: record.comment?.trim() || null,
      visibility: this.visibilityLabel(record),
      summary: this.diffSummary(record)
    };
  }

  private visibilityLabel(record: EntryHistoryRecord): string {
    const oldValue = record.old_visibility_level ?? '-';
    const newValue = record.new_visibility_level ?? '-';

    if (oldValue === newValue) {
      return oldValue === '-' ? '-' : humanizeKey(String(newValue));
    }

    return `${humanizeKey(String(oldValue))} -> ${humanizeKey(String(newValue))}`;
  }

  private diffSummary(record: EntryHistoryRecord): string {
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
