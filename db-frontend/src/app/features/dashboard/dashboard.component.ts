import { AsyncPipe, DatePipe, DecimalPipe, JsonPipe, NgClass, NgFor, NgIf, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { StatsOverviewRecord, StatsService } from '../../core/services/stats.service';
import { ENTRY_SCHEMAS } from '../entry-create/entry-create.schemas';

interface DisplayCard {
  key: string;
  label: string;
  value: number | string;
}

interface CreateOption {
  type: string;
  label: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, JsonPipe, AsyncPipe, DatePipe, DecimalPipe, TranslateModule, NgClass, RouterLink, NgTemplateOutlet],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
  private readonly statsService = inject(StatsService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  readonly overview = this.statsService.overview;
  readonly isLoading = this.statsService.isLoading;
  readonly lastUpdated = this.statsService.lastUpdated;
  readonly createTypeOptions = this.buildCreateOptions();
  readonly selectedCreateType = signal(this.createTypeOptions[0]?.type ?? '');
  readonly hasCreateOptions = this.createTypeOptions.length > 0;

  readonly errorMessage = computed(() => {
    const error = this.statsService.error();
    if (!error) {
      return null;
    }

    const status = error.status || this.translate.instant('dashboard.errors.noStatus');
    const message = error.message || this.translate.instant('dashboard.errors.generic');

    return this.translate.instant('dashboard.errors.loadFailed', { status, message });
  });

  readonly totalCards = computed<DisplayCard[]>(() => {
    const totals = this.overview()?.totals;

    if (!totals) {
      return [];
    }

    return Object.entries(totals).map(([key, value]) => ({
      key,
      label: this.getTransLabel(`dashboard.totals.${key}`, key),
      value
    }));
  });

  readonly activityCards = computed<DisplayCard[]>(() => {
    const activity = this.overview()?.activity;
    if (!activity) {
      return [];
    }

    return Object.entries(activity).map(([key, value]) => ({
      key,
      label: this.getTransLabel(`dashboard.activity.${key}`, key),
      value
    }));
  });

  ngOnInit(): void {
    void this.statsService.loadOverview();
  }

  forceRefresh(): void {
    void this.statsService.loadOverview(true);
  }

  updateCreateType(type: string): void {
    this.selectedCreateType.set(type);
  }

  handleCreateTypeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (!target) {
      return;
    }
    this.updateCreateType(target.value);
  }

  startCreate(): void {
    const type = this.selectedCreateType();
    if (!type) {
      return;
    }

    void this.router.navigate(['/entries', type, 'new']);
  }

  trackByKey(_index: number, item: DisplayCard): string {
    return item.key;
  }

  collectionLink(typeKey: string): string[] | null {
    const normalized = (typeKey ?? '').toString().trim();
    if (!normalized) {
      return null;
    }

    return ['/entries', normalized];
  }

  trackByRecord(index: number, item: StatsOverviewRecord): string {
    return item.id ?? `${item.title ?? item.name ?? 'entry'}-${index}`;
  }

  formatRecordLabel(record: StatsOverviewRecord | undefined, fallbackKey: string): string {
    if (!record) {
      return this.translate.instant(fallbackKey);
    }

    const typeSpecific = this.getTypeSpecificLabel(record);
    if (typeSpecific) {
      return typeSpecific;
    }

    return (
      record.title ||
      record.name ||
      record.summary ||
      record.id ||
      this.translate.instant('dashboard.labels.unknownEntry')
    );
  }

  formatRecordTimestamp(record: StatsOverviewRecord | undefined): string | null {
    if (!record) {
      return null;
    }

    return record.updatedAt || record.timestamp || record.occurredAt || record.createdAt || null;
  }

  formatRecordType(record: StatsOverviewRecord | undefined): string | null {
    if (!record) {
      return null;
    }

    const rawType = record.type;
    const rawId = record.id;
    const type = rawType != null ? String(rawType).trim() : '';
    const id = rawId != null ? String(rawId).trim() : '';
    const hasType = type.length > 0;
    const hasId = id.length > 0;

    if (hasType && hasId) {
      return this.translate.instant('dashboard.labels.itemTypeWithId', { type, id });
    }

    if (hasType) {
      return this.translate.instant('dashboard.labels.itemType', { value: type });
    }

    if (hasId) {
      return this.translate.instant('dashboard.labels.itemId', { value: id });
    }

    return null;
  }

  formatRecordMeta(record: StatsOverviewRecord | undefined): string | null {
    if (!record) {
      return null;
    }

    if (typeof record.summary === 'string' && record.summary.trim().length > 0) {
      return record.summary.trim();
    }

    return this.formatRecordType(record);
  }

  entryLink(record: StatsOverviewRecord | undefined): string[] | null {
    if (!record) {
      return null;
    }

    const type = (record.type ?? '').toString().trim();
    const id = (record.id ?? '').toString().trim();

    if (!type || !id) {
      return null;
    }

    return ['/entries', type, id];
  }
  resolveLatestRecord(record: StatsOverviewRecord | undefined, kind: 'created' | 'updated'): StatsOverviewRecord | undefined {
    if (!record) {
      return undefined;
    }

    const recent = this.overview()?.recent;
    if (!Array.isArray(recent) || recent.length === 0) {
      return record;
    }

    const targetType = (record.type ?? '').toString().toLowerCase();
    const targetTimestamp = this.getTimestampForKind(record, kind);

    if (!targetType || !targetTimestamp) {
      return record;
    }

    const match = recent.find((item) => {
      const itemType = (item.type ?? '').toString().toLowerCase();
      if (itemType !== targetType) {
        return false;
      }

      const itemTimestamp = this.getTimestampForKind(item, kind);
      return !!itemTimestamp && itemTimestamp === targetTimestamp;
    });

    return match ?? record;
  }

  formatRecordTimestampFor(record: StatsOverviewRecord | undefined, kind: 'created' | 'updated'): string | null {
    if (!record) {
      return null;
    }

    return this.getTimestampForKind(record, kind) ?? null;
  }

  private getTimestampForKind(record: StatsOverviewRecord, kind: 'created' | 'updated'): string | undefined {
    if (kind === 'created') {
      return record.createdAt || record.timestamp || record.occurredAt || record.updatedAt || undefined;
    }

    return record.updatedAt || record.timestamp || record.occurredAt || record.createdAt || undefined;
  }

  hasRecentItems(): boolean {
    const recent = this.overview()?.recent;
    return Array.isArray(recent) && recent.length > 0;
  }

  private buildCreateOptions(): CreateOption[] {
    return Object.values(ENTRY_SCHEMAS)
      .map((schema) => ({
        type: schema.type,
        label: schema.title ?? this.humanizeKey(schema.type)
      }))
      .filter((option) => !!option.type)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private getTransLabel(translationKey: string, fallbackKey: string): string {
    const translation = this.translate.instant(translationKey);
    if (translation && translation !== translationKey) {
      return translation;
    }

    return this.humanizeKey(fallbackKey);
  }

  private getTypeSpecificLabel(record: StatsOverviewRecord): string | undefined {
    const metadata = (record.metadata ?? {}) as Record<string, unknown>;
    const type = (record.type ?? '').toString().toLowerCase();

    switch (type) {
      case 'persons':
      case 'person': {
        const first = this.selectText(metadata, ['first_name', 'firstname', 'firstName']);
        const last = this.selectText(metadata, ['last_name', 'lastname', 'lastName']);
        const fullName = [first, last].filter(Boolean).join(' ').trim();
        return fullName.length > 0 ? fullName : undefined;
      }
      case 'profiles':
      case 'profile':
        return this.selectText(metadata, ['username', 'user_name', 'user', 'name']);
      case 'activities':
      case 'activity': {
        const activityType = this.selectText(metadata, ['activity_type', 'type', 'name']);
        return activityType ? this.humanizeKey(activityType) : undefined;
      }
      default:
        return undefined;
    }
  }

  private selectText(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private humanizeKey(value: string): string {
    return value
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}




