import { DatePipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideIconData, icons as lucideIcons } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { LucideIconsModule } from '../../core/modules/lucide-icons.module';
import { DashboardSchemaTotal, StatsService } from '../../core/services/stats.service';

@Component({
  selector: 'app-schema-overview',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, DecimalPipe, RouterLink, TranslateModule, LucideIconsModule],
  templateUrl: './schema-overview.component.html',
  styleUrl: './schema-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SchemaOverviewComponent implements OnInit {
  private readonly statsService = inject(StatsService);
  private readonly translate = inject(TranslateService);

  readonly overview = this.statsService.overview;
  readonly isLoading = this.statsService.isLoading;
  readonly schemas = computed(() => this.overview()?.totals_per_schema ?? []);

  readonly errorMessage = computed(() => {
    const error = this.statsService.error();
    if (!error) {
      return null;
    }

    const status = error.status || this.translate.instant('schemaOverview.errors.noStatus');
    const message =
      (typeof error.error === 'object' && error.error && 'message' in error.error
        ? String((error.error as { message?: unknown }).message ?? '')
        : '') ||
      error.message ||
      this.translate.instant('schemaOverview.errors.generic');

    return this.translate.instant('schemaOverview.errors.loadFailed', { status, message });
  });

  ngOnInit(): void {
    void this.statsService.loadOverview();
  }

  refresh(): void {
    void this.statsService.loadOverview(true);
  }

  trackSchema(_index: number, item: DashboardSchemaTotal): string {
    return `${item.schema_key}-${item.schema_id}`;
  }

  schemaLink(item: DashboardSchemaTotal): string[] {
    return ['/entries', item.schema_key];
  }

  resolveLucideIcon(icon: string | null | undefined): LucideIconData | null {
    const normalized = (icon ?? '').trim();
    if (!normalized) {
      return null;
    }

    const key = normalized
      .split(/[-_\s]+/)
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    const match = (lucideIcons as Record<string, LucideIconData | undefined>)[key];
    return match ?? null;
  }

  iconFallbackLabel(item: DashboardSchemaTotal): string {
    const source = item.schema_name?.trim() || item.schema_key?.trim() || '?';
    return source.charAt(0).toUpperCase();
  }
}
