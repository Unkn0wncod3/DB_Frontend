import { DatePipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, OnInit, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthService } from '../../core/services/auth.service';
import {
  DashboardEntrySummary,
  StatsService
} from '../../core/services/stats.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, DecimalPipe, TranslateModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
  private readonly statsService = inject(StatsService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);

  readonly overview = this.statsService.overview;
  readonly isLoading = this.statsService.isLoading;
  readonly lastUpdated = this.statsService.lastUpdated;

  readonly totalEntries = computed(() => this.overview()?.total_entries ?? 0);
  readonly latestCreated = computed(() => this.overview()?.latest_created ?? []);
  readonly latestUpdated = computed(() => this.overview()?.latest_updated ?? []);
  readonly schemaTotals = computed(() => this.overview()?.totals_per_schema ?? []);
  readonly createMode = signal<'entry' | 'schema'>('entry');
  readonly selectedCreateType = signal('');
  readonly createTypeOptions = computed(() =>
    this.schemaTotals().map((schema) => ({
      type: schema.schema_key,
      label: schema.schema_name
    }))
  );
  readonly selectedCreateTypeLabel = computed(
    () => this.createTypeOptions().find((option) => option.type === this.selectedCreateType())?.label ?? ''
  );

  readonly hasDashboardContent = computed(
    () => this.totalEntries() > 0 || this.latestCreated().length > 0 || this.latestUpdated().length > 0 || this.schemaTotals().length > 0
  );

  readonly errorMessage = computed(() => {
    const error = this.statsService.error();
    if (!error) {
      return null;
    }

    const status = error.status || this.translate.instant('dashboard.errors.noStatus');
    const message =
      (typeof error.error === 'object' && error.error && 'message' in error.error
        ? String((error.error as { message?: unknown }).message ?? '')
        : '') ||
      error.message ||
      this.translate.instant('dashboard.errors.generic');

    return this.translate.instant('dashboard.errors.loadFailed', { status, message });
  });

  constructor() {
    effect(
      () => {
        const options = this.createTypeOptions();
        const current = this.selectedCreateType();
        if (!options.some((option) => option.type === current)) {
          this.selectedCreateType.set(options[0]?.type ?? '');
        }
      },
      { allowSignalWrites: true }
    );

    effect(
      () => {
        if (this.createMode() === 'schema' && !this.auth.canManageSchemas()) {
          this.createMode.set('entry');
        }
      },
      { allowSignalWrites: true }
    );

    this.translate.onLangChange.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      // recompute translation-backed labels
    });
  }

  ngOnInit(): void {
    void this.statsService.loadOverview();
  }

  forceRefresh(): void {
    void this.statsService.loadOverview(true);
  }

  selectCreateType(type: string): void {
    this.selectedCreateType.set(type);
  }

  selectCreateMode(mode: 'entry' | 'schema'): void {
    this.createMode.set(mode);
  }

  startCreate(): void {
    if (this.createMode() === 'schema') {
      void this.router.navigate(['/schemas/new']);
      return;
    }

    const schemaKey = this.selectedCreateType();
    if (!schemaKey) {
      return;
    }

    void this.router.navigate(['/entries', schemaKey, 'new']);
  }

  entryLink(item: DashboardEntrySummary): string[] {
    return ['/entries', item.schema_key, String(item.id)];
  }

  latestTimestamp(item: DashboardEntrySummary, mode: 'created' | 'updated'): string | null {
    if (mode === 'created') {
      return item.created_at ?? null;
    }

    return item.updated_at ?? item.created_at ?? null;
  }

  trackEntry(_index: number, item: DashboardEntrySummary): string {
    return `${item.schema_key}-${item.id}`;
  }
}
