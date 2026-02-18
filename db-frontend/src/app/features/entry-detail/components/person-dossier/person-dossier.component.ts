import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { PersonDossierService } from '../../../../core/services/person-dossier.service';
import {
  PersonDossierLimits,
  PersonDossierRelationItem,
  PersonDossierResponse,
  PersonDossierStatsSection
} from '../../../../shared/types/person-dossier.types';
import { EntryDetailRawViewComponent } from '../entry-detail-raw-view/entry-detail-raw-view.component';

interface DossierSectionConfig {
  key: keyof PersonDossierLimits;
  translationKey: string;
}

@Component({
  selector: 'app-person-dossier',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DatePipe, TranslateModule, EntryDetailRawViewComponent],
  templateUrl: './person-dossier.component.html',
  styleUrls: ['./person-dossier.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonDossierComponent implements OnChanges {
  private readonly dossierService = inject(PersonDossierService);
  private readonly translate = inject(TranslateService);
  private requestToken = 0;

  @Input() personId: string | null = null;
  @Input() personName: string | null = null;

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly state = signal<PersonDossierResponse | null>(null);
  readonly limits = signal<PersonDossierLimits>({ profiles: 5, notes: 5, activities: 5 });
  readonly isPdfDownloading = signal(false);
  readonly showRawData = signal(false);

  readonly sectionConfigs: DossierSectionConfig[] = [
    { key: 'profiles', translationKey: 'dossier.sections.profiles' },
    { key: 'notes', translationKey: 'dossier.sections.notes' },
    { key: 'activities', translationKey: 'dossier.sections.activities' }
  ];

  readonly limitOptions = [5, 10, 25, 50];

  readonly hasAdminVisibility = computed(() => {
    const meta = this.state()?.meta;
    return !!meta?.can_view_admin_sections;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if ('personId' in changes && this.personId) {
      this.fetchDossier(true);
    }
  }

  refresh(): void {
    this.fetchDossier(true);
  }

  updateLimit(section: keyof PersonDossierLimits, value: number): void {
    const current = this.limits();
    if (current[section] === value) {
      return;
    }
    this.limits.set({ ...current, [section]: value });
    this.fetchDossier();
  }

  onLimitChange(section: keyof PersonDossierLimits, event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const parsed = target ? Number(target.value) : NaN;
    const value = Number.isFinite(parsed) ? parsed : this.limits()[section];
    this.updateLimit(section, value);
  }

  async downloadPdf(): Promise<void> {
    if (!this.personId || this.isPdfDownloading()) {
      return;
    }
    this.isPdfDownloading.set(true);
    try {
      const result = await firstValueFrom(
        this.dossierService.downloadPdf(this.personId, this.limits())
      );

      const blobUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isPdfDownloading.set(false);
    }
  }

  trackRelation(_index: number, item: PersonDossierRelationItem): string | number | undefined {
    return item.id ?? _index;
  }

  statValue(section: keyof PersonDossierLimits): PersonDossierStatsSection | null {
    const stats = this.state()?.stats;
    if (!stats) {
      return null;
    }
    switch (section) {
      case 'profiles':
        return stats.profiles ?? null;
      case 'notes':
        return stats.notes ?? null;
      case 'activities':
        return stats.activities ?? null;
      default:
        return null;
    }
  }

  relationItems(section: keyof PersonDossierLimits): PersonDossierRelationItem[] {
    const relations = this.state()?.relations;
    if (!relations) {
      return [];
    }
    switch (section) {
      case 'profiles':
        return relations.profiles ?? [];
      case 'notes':
        return relations.notes ?? [];
      case 'activities':
        return relations.activities ?? [];
      default:
        return [];
    }
  }

  sectionLimit(section: keyof PersonDossierLimits): number {
    const meta = this.state()?.meta;
    if (!meta?.limits) {
      return this.limits()[section];
    }
    return meta.limits[section] ?? this.limits()[section];
  }

  visibilityBadgeKey(item: PersonDossierRelationItem): string {
    const value = String(item.visibility_level ?? '').toLowerCase();
    return value === 'admin' ? 'entryVisibility.badge.admin' : 'entryVisibility.badge.user';
  }

  hasAdminBadge(item: PersonDossierRelationItem): boolean {
    return (item.visibility_level ?? '').toString().toLowerCase() === 'admin';
  }

  sectionCount(section: keyof PersonDossierLimits): number {
    const statsCount = this.statValue(section)?.count;
    return typeof statsCount === 'number' ? statsCount : this.relationItems(section).length;
  }

  sectionUpdatedAt(section: keyof PersonDossierLimits): string | null {
    return this.statValue(section)?.last_updated_at ?? null;
  }

  toggleRawData(): void {
    this.showRawData.set(!this.showRawData());
  }

  relationLabel(section: keyof PersonDossierLimits, item: PersonDossierRelationItem): string {
    if (section === 'profiles') {
      const platform = this.extractText(item, ['platform_name', 'platform']);
      const username = this.extractText(item, ['username', 'display_name', 'label']);
      const parts = [platform, username].filter((value) => typeof value === 'string' && value.trim().length > 0);
      if (parts.length > 0) {
        return parts.join(' — ');
      }
    }
    if (section === 'notes') {
      return this.extractText(item, ['title', 'label']) ?? this.translate.instant('dossier.meta.unknown');
    }
    if (section === 'activities') {
      return (
        this.extractText(item, ['activity_type', 'label', 'title']) ??
        this.translate.instant('dossier.meta.unknown')
      );
    }
    return this.extractText(item, ['label', 'title']) ?? this.translate.instant('dossier.meta.unknown');
  }

  private extractText(source: PersonDossierRelationItem, keys: string[]): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private fetchDossier(force = false): void {
    if (!this.personId) {
      return;
    }
    const token = ++this.requestToken;
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.dossierService
      .fetchDossier(this.personId, this.limits(), { force })
      .subscribe({
        next: (snapshot) => {
          if (token !== this.requestToken) {
            return;
          }
          this.state.set(snapshot.data);
          if (snapshot.data.meta?.limits) {
            this.limits.set({ ...snapshot.data.meta.limits });
          }
        },
        error: (error) => {
          if (token === this.requestToken) {
            this.errorMessage.set(this.describeError(error));
          }
        }
      })
      .add(() => {
        if (token === this.requestToken) {
          this.isLoading.set(false);
        }
      });
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 403 || error.status === 404)) {
      return this.translate.instant('entryDetail.errors.hiddenFromUser');
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('dossier.errors.generic');
  }
}
