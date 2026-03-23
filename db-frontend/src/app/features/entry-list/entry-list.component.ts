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

interface SearchFieldOption {
  key: string;
  label: string;
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
  readonly searchQuery = signal('');
  readonly searchField = signal('all');
  readonly schema = signal<EntrySchema | null>(null);
  readonly lastUpdatedAt = signal<number | null>(null);
  readonly schemaLabel = computed(() => this.schema()?.name ?? humanizeKey(this.currentSchemaKey ?? 'entries'));
  readonly columns = computed(() => this.buildColumns(this.schema()));
  readonly searchFieldOptions = computed<SearchFieldOption[]>(() => [
    { key: 'all', label: this.translate.instant('entryList.filters.allFields') },
    { key: '__title', label: this.translate.instant('entryList.filters.title') },
    { key: '__status', label: this.translate.instant('entryList.filters.status') },
    { key: '__visibility', label: this.translate.instant('entryList.filters.visibility') },
    { key: '__id', label: this.translate.instant('entryList.filters.id') },
    { key: '__owner', label: this.translate.instant('entryList.filters.owner') },
    { key: '__created', label: this.translate.instant('entryList.filters.created') },
    { key: '__updated', label: this.translate.instant('entryList.filters.updated') },
    ...this.columns()
      .filter((column) => !['__title', '__status', '__visibility', '__updated'].includes(column.key))
      .map((column) => ({ key: column.key, label: column.label }))
  ]);
  readonly filteredEntries = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const searchField = this.searchField();

    return this.entries().filter((entry) => {
      if (!query) {
        return true;
      }

      return this.getSearchValues(entry, searchField).some((value) => value.toLowerCase().includes(query));
    });
  });
  readonly total = computed(() => this.filteredEntries().length);

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

  onSearchInput(value: string): void {
    this.searchQuery.set((value || '').trim());
  }

  onSearchFieldChange(value: string): void {
    this.searchField.set(value || 'all');
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

  trackBySearchField(_index: number, option: SearchFieldOption): string {
    return option.key;
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

    const formatted = formatFieldValue(getFieldValue(entry, column.field!), column.field);
    return formatted == null ? '' : String(formatted);
  }

  isDateColumn(column: DisplayColumn): boolean {
    return column.key === '__updated' || column.field?.data_type === 'date' || column.field?.data_type === 'datetime';
  }

  isOwnedByCurrentUser(entry: EntryRecord): boolean {
    const currentUserId = this.auth.user()?.id;
    return currentUserId != null && entry.owner_id != null && String(entry.owner_id) === String(currentUserId);
  }

  private getSearchValues(entry: EntryRecord, searchField: string): string[] {
    if (searchField === 'all') {
      return [
        resolveEntryTitle(entry, this.schema()),
        entry.status,
        entry.visibility_level,
        entry.id,
        entry.owner_id,
        entry.updated_at,
        entry.created_at,
        ...this.columns().map((column) => this.formatCell(entry, column))
      ]
        .filter((value) => value != null && String(value).trim().length > 0)
        .map((value) => String(value).trim());
    }

    if (searchField === '__id') {
      return entry.id == null ? [] : [String(entry.id)];
    }

    if (searchField === '__owner') {
      return entry.owner_id == null ? [] : [String(entry.owner_id)];
    }

    if (searchField === '__created') {
      return entry.created_at ? [String(entry.created_at)] : [];
    }

    const matchingColumn = this.columns().find((column) => column.key === searchField);
    if (!matchingColumn) {
      return [];
    }

    const value = this.formatCell(entry, matchingColumn);
    return value.trim().length > 0 ? [value.trim()] : [];
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
