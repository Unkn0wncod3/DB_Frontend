import { AsyncPipe, DatePipe, JsonPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EntryListParams, EntryService } from '../../core/services/entry.service';

interface DisplayColumn {
  key: string;
  label: string;
}

@Component({
  selector: 'app-entry-list',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, ReactiveFormsModule, RouterModule, AsyncPipe, JsonPipe, DatePipe, TranslateModule],
  templateUrl: './entry-list.component.html',
  styleUrl: './entry-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryListComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly entryService = inject(EntryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  private readonly defaultPageSize = 25;
  private readonly pageSizeOptions = [10, 25, 50, 100];
  private readonly columnPriority: Record<string, string[]> = {
    default: ['id'],
    persons: ['first_name', 'last_name', 'email','status'],
    notes: ['title', 'created_at', 'text'],
    profiles: ['username', 'platform_id', 'status', 'last_seen_at', 'region'],
    activities: ['activity_type', 'item', 'person_id', 'occurred_at', 'notes'],
    vehicles: ['label', 'model', 'vehicle_type', 'license_plate'],
    platforms: ['name', 'is_active', 'base_url']
  };

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly items = signal<Record<string, unknown>[]>([]);
  readonly total = signal<number | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(this.defaultPageSize);
  readonly hasMore = signal(false);
  readonly columns = signal<DisplayColumn[]>([]);
  readonly listTitle = signal('');
  readonly lastUpdatedAt = signal<number | null>(null);

  readonly searchControl = this.fb.nonNullable.control<string>('');
  readonly pageSizeControl = this.fb.nonNullable.control<number>(this.defaultPageSize);

  private currentType: string | null = null;
  private skipNextQuerySync = false;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const type = params.get('type');
      if (!type) {
        this.errorMessage.set(this.translate.instant('entryList.errors.missingType'));
        return;
      }

      if (type === this.currentType) {
        return;
      }

      this.currentType = type;
      this.listTitle.set(this.buildTitle(type));
      this.resetControls();
      this.skipNextQuerySync = true;
      this.syncFromRoute();
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.skipNextQuerySync) {
        this.skipNextQuerySync = false;
        return;
      }

      this.syncFromRoute();
    });

    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.updateQuery({ search: value ?? '', page: 1 });
      });

    this.pageSizeControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        const size = this.normalizePageSize(value ?? this.defaultPageSize);
        this.updateQuery({ pageSize: size, page: 1 });
      });
  }

  get pageSizeOptionsView(): number[] {
    return this.pageSizeOptions;
  }

  trackByIndex(index: number): number {
    return index;
  }

  trackByColumn(_index: number, column: DisplayColumn): string {
    return column.key;
  }

  createLink(): string[] | null {
    if (!this.currentType) {
      return null;
    }

    return ['/entries', this.currentType, 'new'];
  }

  timelineLink(): string[] | null {
    if (!this.currentType) {
      return null;
    }

    if ((this.currentType ?? '').toLowerCase() !== 'activities') {
      return null;
    }

    return ['/entries', 'activities', 'timeline'];
  }

  isActivitiesList(): boolean {
    return (this.currentType ?? '').toLowerCase() === 'activities';
  }

  hasEntryId(item: Record<string, unknown>): boolean {
    return this.extractId(item) !== null;
  }

  formatValue(value: unknown): string {
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
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  navigateToEntry(item: Record<string, unknown>): void {
    const id = this.extractId(item);
    if (!id || !this.currentType) {
      return;
    }

    void this.router.navigate(['/entries', this.currentType, id]);
  }

  goToPreviousPage(): void {
    const current = this.page();
    if (current <= 1) {
      return;
    }

    this.updateQuery({ page: current - 1 });
  }

  goToNextPage(): void {
    if (!this.hasMore()) {
      return;
    }

    this.updateQuery({ page: this.page() + 1 });
  }

  refresh(): void {
    if (!this.currentType) {
      return;
    }

    this.loadEntries(this.buildParamsFromState());
  }

  private syncFromRoute(): void {
    if (!this.currentType) {
      return;
    }

    const query = this.route.snapshot.queryParamMap;
    const page = this.normalizePage(Number(query.get('page')) || 1);
    const pageSize = this.normalizePageSize(Number(query.get('pageSize')) || Number(query.get('limit')) || this.defaultPageSize);
    const search = (query.get('search') ?? query.get('q') ?? '').toString();

    this.page.set(page);
    this.pageSize.set(pageSize);
    this.searchControl.setValue(search, { emitEvent: false });
    this.pageSizeControl.setValue(pageSize, { emitEvent: false });

    this.loadEntries({
      type: this.currentType,
      page,
      pageSize,
      search
    });
  }

  private loadEntries(params: EntryListParams & { type: string }): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.entryService
      .listEntries(params.type, params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.items.set(result.items);
          this.total.set(result.total);
          this.page.set(result.page);
          this.pageSize.set(result.pageSize);
          this.hasMore.set(result.hasMore);
          this.columns.set(this.deriveColumns(result.items));
          this.lastUpdatedAt.set(Date.now());
        },
        error: (error: unknown) => {
          const message = error instanceof Error ? error.message : this.translate.instant('entryList.errors.unknown');
          this.errorMessage.set(this.translate.instant('entryList.errors.loadFailed', { message }));
        }
      })
      .add(() => {
        this.isLoading.set(false);
      });
  }

  private updateQuery(params: { page?: number; pageSize?: number; search?: string }): void {
    if (!this.currentType) {
      return;
    }

    const merged = {
      page: params.page ?? this.page(),
      pageSize: params.pageSize ?? this.pageSize(),
      search: params.search ?? this.searchControl.value ?? ''
    };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        page: merged.page,
        pageSize: merged.pageSize,
        search: merged.search || null
      },
      queryParamsHandling: 'merge'
    });
  }

  private buildParamsFromState(): EntryListParams & { type: string } {
    if (!this.currentType) {
      throw new Error('Entry type missing');
    }

    return {
      type: this.currentType,
      page: this.page(),
      pageSize: this.pageSize(),
      search: this.searchControl.value ?? ''
    };
  }

  private deriveColumns(items: Record<string, unknown>[]): DisplayColumn[] {
    const keys = new Set<string>();
    for (const item of items.slice(0, 10)) {
      for (const [key, value] of Object.entries(item)) {
        if (key.startsWith('_') || key === 'metadata') {
          continue;
        }

        if (this.isDisplayable(value)) {
          keys.add(key);
        }
      }
    }

    const priorities = this.getPrioritizedKeys();
    for (const priorityKey of priorities) {
      if (this.itemsContainKey(items, priorityKey)) {
        keys.add(priorityKey);
      }
    }

    if (keys.size === 0) {
      return [];
    }

    const orderedKeys = this.orderColumns(Array.from(keys));

    return orderedKeys
      .slice(0, 6)
      .map((key) => ({ key, label: this.humanizeKey(key) }));
  }

  private orderColumns(keys: string[]): string[] {
    if (keys.length === 0) {
      return [];
    }

    const prioritizedKeys = this.getPrioritizedKeys();
    const result: string[] = [];
    const used = new Set<string>();

    for (const priorityKey of prioritizedKeys) {
      const actualKey = keys.find((key) => key === priorityKey);
      if (actualKey && !used.has(actualKey)) {
        result.push(actualKey);
        used.add(actualKey);
      }
    }

    keys
      .sort()
      .forEach((key) => {
        if (!used.has(key)) {
          result.push(key);
          used.add(key);
        }
      });

    return result;
  }

  private getPrioritizedKeys(): string[] {
    const normalizedType = (this.currentType ?? '').toLowerCase();
    const typeSpecific = this.columnPriority[normalizedType] ?? [];
    const defaults = this.columnPriority['default'] ?? [];
    return [...defaults, ...typeSpecific];
  }

  private itemsContainKey(items: Record<string, unknown>[], key: string): boolean {
    return items.some((item) => Object.prototype.hasOwnProperty.call(item, key));
  }

  private isDisplayable(value: unknown): boolean {
    if (value == null) {
      return true;
    }

    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  private extractId(item: Record<string, unknown>): string | null {
    const preferredKeys = ['id', '_id', 'uuid'];
    for (const key of preferredKeys) {
      const value = item[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return value.toString();
      }
    }
    return null;
  }

  private resetControls(): void {
    this.page.set(1);
    this.pageSize.set(this.defaultPageSize);
    this.searchControl.setValue('', { emitEvent: false });
    this.pageSizeControl.setValue(this.defaultPageSize, { emitEvent: false });
  }

  private normalizePageSize(value: number): number {
    return Math.max(1, Math.min(200, Math.trunc(value || this.defaultPageSize)));
  }

  private normalizePage(value: number): number {
    return Math.max(1, Math.trunc(value || 1));
  }

  private buildTitle(type: string): string {
    const key = `entryList.types.${type}`;
    const translated = this.translate.instant(key);
    if (translated && translated !== key) {
      return translated;
    }
    return this.humanizeKey(type);
  }

  private humanizeKey(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
