import { AsyncPipe, DatePipe, DecimalPipe, JsonPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { StatsOverviewRecord, StatsService } from '../../core/services/stats.service';

interface DisplayCard {
  key: string;
  label: string;
  value: number | string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, JsonPipe, AsyncPipe, DatePipe, DecimalPipe, TranslateModule, NgClass],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
  private readonly statsService = inject(StatsService);
  private readonly translate = inject(TranslateService);

  readonly overview = this.statsService.overview;
  readonly isLoading = this.statsService.isLoading;
  readonly lastUpdated = this.statsService.lastUpdated;

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

  trackByKey(_index: number, item: DisplayCard): string {
    return item.key;
  }

  trackByRecord(index: number, item: StatsOverviewRecord): string {
    return item.id ?? `${item.title ?? item.name ?? 'entry'}-${index}`;
  }

  formatRecordLabel(record: StatsOverviewRecord | undefined, fallbackKey: string): string {
    if (!record) {
      return this.translate.instant(fallbackKey);
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

    return record.updatedAt || record.timestamp || record.createdAt || null;
  }

  hasRecentItems(): boolean {
    const recent = this.overview()?.recent;
    return Array.isArray(recent) && recent.length > 0;
  }

  private getTransLabel(translationKey: string, fallbackKey: string): string {
    const translation = this.translate.instant(translationKey);
    if (translation && translation !== translationKey) {
      return translation;
    }

    return this.humanizeKey(fallbackKey);
  }

  private humanizeKey(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
