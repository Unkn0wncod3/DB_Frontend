import { DatePipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EntryListParams, EntryService } from '../../core/services/entry.service';
import { PersonLookupComponent } from '../person-lookup/person-lookup.component';

interface TimelineEntry {
  id?: string;
  title: string;
  description?: string;
  occurredAt?: string;
  routerLink?: string[];
  personId?: string | number;
}

@Component({
  selector: 'app-activities-timeline',
  standalone: true,
  imports: [NgIf, NgFor, ReactiveFormsModule, RouterModule, DatePipe, TranslateModule, PersonLookupComponent],
  templateUrl: './activities-timeline.component.html',
  styleUrl: './activities-timeline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActivitiesTimelineComponent {
  private readonly fb = inject(FormBuilder);
  private readonly entryService = inject(EntryService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly filterForm = this.fb.nonNullable.group({
    personId: [''],
    fromDate: [''],
    toDate: [''],
    limit: [100]
  });

  readonly entries = signal<TimelineEntry[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly lastUpdatedAt = signal<number | null>(null);

  constructor() {
    this.filterForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.loadEntries();
    });
    void this.loadEntries();
  }

  async loadEntries(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const formValue = this.filterForm.getRawValue();
      const params: EntryListParams = {
        page: 1,
        pageSize: formValue.limit ?? 100,
        filters: {}
      };
      const personId = (formValue.personId ?? '').trim();
      if (personId.length > 0) {
        params.filters!['person_id'] = personId;
      }

      const result = await this.entryService.listEntries('activities', params).toPromise();
      if (!result) {
        this.entries.set([]);
        return;
      }

      const filtered = this.applyDateRange(result.items, formValue.fromDate, formValue.toDate);
      const sorted = filtered.sort((a, b) => {
        const aTime = this.extractTimestamp(a);
        const bTime = this.extractTimestamp(b);
        return bTime - aTime;
      });
      this.entries.set(sorted.map((record) => this.toTimelineEntry(record)));
      this.lastUpdatedAt.set(Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : this.translate.instant('entryList.errors.unknown');
      this.errorMessage.set(message);
    } finally {
      this.isLoading.set(false);
    }
  }

  resetFilters(): void {
    this.filterForm.reset({ personId: '', fromDate: '', toDate: '', limit: 100 });
  }

  trackByEntry(_index: number, entry: TimelineEntry): string {
    return entry.id ?? `${entry.title}-${_index}`;
  }

  selectedFilterPersonId(): string | null {
    const control = this.filterForm.get('personId');
    const value = (control?.value ?? '').toString().trim();
    return value.length > 0 ? value : null;
  }

  private applyDateRange(items: Record<string, unknown>[], fromDate?: string | null, toDate?: string | null): Record<string, unknown>[] {
    const fromTs = fromDate ? Date.parse(fromDate) : null;
    const toTs = toDate ? Date.parse(toDate) : null;

    if (!fromTs && !toTs) {
      return items;
    }

    return items.filter((item) => {
      const timestamp = this.extractTimestamp(item);
      if (timestamp === Number.NEGATIVE_INFINITY) {
        return true;
      }
      if (fromTs && timestamp < fromTs) {
        return false;
      }
      if (toTs && timestamp > toTs) {
        return false;
      }
      return true;
    });
  }

  private extractTimestamp(record: Record<string, unknown>): number {
    const value = record['occurred_at'] ?? record['timestamp'] ?? record['created_at'] ?? record['updated_at'];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return Number.NEGATIVE_INFINITY;
  }

  private toTimelineEntry(record: Record<string, unknown>): TimelineEntry {
    const id = this.extractId(record);
    const title = this.extractText(record, ['activity_type', 'title', 'item']) ?? 'Activity';
    const description = this.extractText(record, ['item', 'notes']);
    const occurredAt = typeof record['occurred_at'] === 'string' ? record['occurred_at'] as string : undefined;
    const personId = record['person_id'];

    return {
      id,
      title,
      description,
      occurredAt,
      personId: typeof personId === 'number' || typeof personId === 'string' ? personId : undefined,
      routerLink: id ? ['/entries', 'activities', id] : undefined
    };
  }

  private extractText(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  private extractId(record: Record<string, unknown>): string | undefined {
    const value = record['id'] ?? record['_id'];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    return undefined;
  }
}
