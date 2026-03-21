import { DatePipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { EntryRecord, EntrySchema } from '../../core/models/metadata.models';
import { AuthService } from '../../core/services/auth.service';
import { EntryService } from '../../core/services/entry.service';
import { SchemaService } from '../../core/services/schema.service';
import { resolveEntryTitle } from '../../core/utils/schema.utils';

interface MyEntryListItem {
  entry: EntryRecord;
  schema: EntrySchema | null;
}

@Component({
  selector: 'app-my-entries',
  standalone: true,
  imports: [NgIf, NgFor, RouterLink, DatePipe, TranslateModule],
  templateUrl: './my-entries.component.html',
  styleUrl: './my-entries.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MyEntriesComponent {
  private readonly entryService = inject(EntryService);
  private readonly schemaService = inject(SchemaService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly lastUpdatedAt = signal<number | null>(null);
  readonly items = signal<MyEntryListItem[]>([]);
  readonly total = computed(() => this.items().length);

  constructor() {
    void this.load();
  }

  async refresh(): Promise<void> {
    await this.load(true);
  }

  openEntry(item: MyEntryListItem): void {
    if (!item.schema) {
      return;
    }

    void this.router.navigate(['/entries', item.schema.key, item.entry.id]);
  }

  trackByEntry(_index: number, item: MyEntryListItem): string {
    return `${item.schema?.key ?? 'unknown'}-${item.entry.id}`;
  }

  entryTitle(item: MyEntryListItem): string {
    return resolveEntryTitle(item.entry, item.schema);
  }

  private async load(forceRefresh = false): Promise<void> {
    const currentUser = this.auth.user();
    if (!currentUser?.id) {
      this.items.set([]);
      this.errorMessage.set(this.translate.instant('myEntries.errors.missingUser'));
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const [schemas, entries] = await Promise.all([
        firstValueFrom(this.schemaService.loadSchemas(forceRefresh)),
        firstValueFrom(this.entryService.listEntries({ owner_id: currentUser.id }))
      ]);

      const schemaMap = new Map(schemas.map((schema) => [String(schema.id), schema]));
      const items = entries
        .filter((entry) => !entry.deleted_at)
        .map<MyEntryListItem>((entry) => ({
          entry,
          schema: schemaMap.get(String(entry.schema_id)) ?? null
        }))
        .sort((left, right) => {
          const leftUpdated = left.entry.updated_at ?? left.entry.created_at ?? '';
          const rightUpdated = right.entry.updated_at ?? right.entry.created_at ?? '';
          return rightUpdated.localeCompare(leftUpdated);
        });

      this.items.set(items);
      this.lastUpdatedAt.set(Date.now());
    } catch (error) {
      this.errorMessage.set(this.describeError(error));
      this.items.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('myEntries.errors.loadFallback');
  }
}
