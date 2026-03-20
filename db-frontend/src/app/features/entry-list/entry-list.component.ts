import { AsyncPipe, DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { EntryService } from '../../core/services/entry.service';
import { SchemaService } from '../../core/services/schema.service';
import { EntryRecord, EntrySchema, SchemaField } from '../../core/models/metadata.models';
import { formatFieldValue, getFieldValue, humanizeKey, resolveEntryTitle } from '../../core/utils/schema.utils';

interface DisplayColumn {
  key: string;
  label: string;
  field?: SchemaField;
}

@Component({
  selector: 'app-entry-list',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, RouterModule, AsyncPipe, DatePipe, TranslateModule],
  templateUrl: './entry-list.component.html',
  styleUrl: './entry-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryListComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly entryService = inject(EntryService);
  private readonly schemaService = inject(SchemaService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  readonly auth = inject(AuthService);

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly entries = signal<EntryRecord[]>([]);
  readonly schema = signal<EntrySchema | null>(null);
  readonly lastUpdatedAt = signal<number | null>(null);
  readonly schemaLabel = computed(() => this.schema()?.name ?? humanizeKey(this.currentSchemaKey ?? 'entries'));
  readonly columns = computed(() => this.buildColumns(this.schema()));

  private currentSchemaKey: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const schemaKey = params.get('schemaKey');
      if (!schemaKey || schemaKey === this.currentSchemaKey) {
        return;
      }
      this.currentSchemaKey = schemaKey;
      void this.load();
    });
  }

  createLink(): string[] | null {
    if (!this.schema() || !this.auth.canCreateEntries()) {
      return null;
    }
    return ['/entries', this.schema()!.key, 'new'];
  }

  async refresh(): Promise<void> {
    await this.load();
  }

  openEntry(entry: EntryRecord): void {
    void this.router.navigate(['/entries', this.currentSchemaKey, entry.id]);
  }

  trackByEntry(_index: number, entry: EntryRecord): string | number {
    return entry.id;
  }

  trackByColumn(_index: number, column: DisplayColumn): string {
    return column.key;
  }

  formatCell(entry: EntryRecord, column: DisplayColumn): string {
    if (column.key === '__title') {
      return resolveEntryTitle(entry, this.schema());
    }

    if (column.key === '__status') {
      return entry.status ?? '';
    }

    if (column.key === '__visibility') {
      return entry.visibility_level;
    }

    if (column.key === '__updated') {
      return entry.updated_at ?? '';
    }

    return formatFieldValue(getFieldValue(entry, column.field!), column.field);
  }

  isDateColumn(column: DisplayColumn): boolean {
    return column.key === '__updated' || column.field?.data_type === 'date' || column.field?.data_type === 'datetime';
  }

  private async load(): Promise<void> {
    if (!this.currentSchemaKey) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const schemas = await firstValueFrom(this.schemaService.loadSchemas());
      const schema = schemas.find((item) => item.key === this.currentSchemaKey) ?? null;
      if (!schema) {
        this.errorMessage.set(this.translate.instant('entryList.errors.unknownSchema', { schema: this.currentSchemaKey }));
        this.entries.set([]);
        this.schema.set(null);
        return;
      }

      this.schema.set(schema);
      const entries = await firstValueFrom(this.entryService.listEntries({ schema_id: schema.id }));
      this.entries.set(entries.filter((entry) => !entry.deleted_at));
      this.lastUpdatedAt.set(Date.now());
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private buildColumns(schema: EntrySchema | null): DisplayColumn[] {
    if (!schema) {
      return [];
    }

    const fieldColumns = schema.fields
      .filter((field) => field.is_active)
      .slice(0, 4)
      .map<DisplayColumn>((field) => ({
        key: field.key,
        label: field.label || humanizeKey(field.key),
        field
      }));

    return [
      { key: '__title', label: 'Title' },
      { key: '__status', label: 'Status' },
      ...fieldColumns,
      { key: '__visibility', label: 'Visibility' },
      { key: '__updated', label: 'Updated' }
    ];
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('entryList.errors.loadFallback');
  }
}
