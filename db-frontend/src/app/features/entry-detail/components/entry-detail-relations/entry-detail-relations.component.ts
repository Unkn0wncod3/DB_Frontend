import { DatePipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../../../../core/services/api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { RelatedEntryItem } from '../../entry-detail.types';
import { ProfileLookupComponent } from '../../../../shared/components/profile-lookup/profile-lookup.component';

@Component({
  selector: 'app-entry-detail-relations',
  standalone: true,
  imports: [NgIf, NgFor, ReactiveFormsModule, RouterModule, TranslateModule, DatePipe, ProfileLookupComponent],
  templateUrl: './entry-detail-relations.component.html',
  styleUrls: ['./entry-detail-relations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryDetailRelationsComponent implements OnChanges {
  private readonly api = inject(ApiService);
  private readonly translate = inject(TranslateService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  @Input({ required: true }) personId: string | null = null;
  @Input() entryTitle: string | null = null;
  @Input() layout: 'side' | 'stacked' = 'side';

  @Output() statusMessage = new EventEmitter<string>();

  readonly relatedProfiles = signal<RelatedEntryItem[]>([]);
  readonly relatedNotes = signal<RelatedEntryItem[]>([]);
  readonly relatedActivities = signal<RelatedEntryItem[]>([]);
  readonly isRelationsLoading = signal(false);
  readonly relationsError = signal<string | null>(null);
  readonly profileLinkError = signal<string | null>(null);
  readonly isManagingProfileLinks = signal(false);

  readonly hasRelations = computed(
    () => this.relatedProfiles().length > 0 || this.relatedNotes().length > 0 || this.relatedActivities().length > 0
  );

  readonly profileLinkForm = this.fb.nonNullable.group({
    profileId: ['', [Validators.required]],
    note: ['']
  });

  ngOnChanges(changes: SimpleChanges): void {
    if ('personId' in changes) {
      const newId = this.personId?.trim();
      if (newId) {
        void this.loadPersonRelations(newId);
      } else {
        this.clearRelations();
      }
    }
  }

  relationListLink(type: string): string[] {
    return ['/entries', type];
  }

  canManageRelations(): boolean {
    return this.auth.canWrite();
  }

  trackByRelation(_index: number, item: RelatedEntryItem): string {
    return `${item.type}-${item.id ?? _index}`;
  }

  async linkProfile(): Promise<void> {
    const id = this.personId?.trim();
    if (!id) {
      return;
    }

    this.profileLinkForm.markAllAsTouched();
    if (this.profileLinkForm.invalid) {
      this.profileLinkError.set(this.translate.instant('entryDetail.relations.profileLinkInvalid'));
      return;
    }

    const raw = this.profileLinkForm.getRawValue();
    const parsedId = Number(raw.profileId);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      this.profileLinkError.set(this.translate.instant('entryDetail.relations.profileLinkInvalid'));
      return;
    }

    this.profileLinkError.set(null);
    this.isManagingProfileLinks.set(true);
    try {
      await firstValueFrom(
        this.api.request('POST', `/persons/${id}/profiles`, {
          body: {
            profile_id: parsedId,
            note: raw.note?.trim().length ? raw.note.trim() : null
          }
        })
      );
      this.profileLinkForm.reset({ profileId: '', note: '' });
      await this.loadPersonRelations(id);
      this.statusMessage.emit(this.translate.instant('entryDetail.relations.profileLinked'));
    } catch (error) {
      this.profileLinkError.set(this.describeError(error));
    } finally {
      this.isManagingProfileLinks.set(false);
    }
  }

  async unlinkProfile(profileId?: string): Promise<void> {
    const id = this.personId?.trim();
    if (!id || !profileId) {
      return;
    }

    const parsedId = Number(profileId);
    if (!Number.isFinite(parsedId)) {
      return;
    }

    this.isManagingProfileLinks.set(true);
    this.profileLinkError.set(null);
    try {
      await firstValueFrom(this.api.request('DELETE', `/persons/${id}/profiles/${parsedId}`));
      await this.loadPersonRelations(id);
      this.statusMessage.emit(this.translate.instant('entryDetail.relations.profileUnlinked'));
    } catch (error) {
      this.profileLinkError.set(this.describeError(error));
    } finally {
      this.isManagingProfileLinks.set(false);
    }
  }

  private async loadPersonRelations(personId: string): Promise<void> {
    if (!personId) {
      return;
    }

    this.isRelationsLoading.set(true);
    this.relationsError.set(null);
    try {
      const [profilesResult, notesResult, activitiesResult] = await Promise.allSettled([
        firstValueFrom(this.api.request<unknown>('GET', `/persons/${personId}/profiles`)),
        firstValueFrom(this.api.request<unknown>('GET', `/notes/by-person/${personId}`)),
        firstValueFrom(this.api.request<unknown>('GET', '/activities', { params: { person_id: personId, limit: 50 } }))
      ]);

      const errors: string[] = [];

      if (profilesResult.status === 'fulfilled') {
        this.relatedProfiles.set(this.normalizeProfiles(profilesResult.value));
      } else {
        errors.push(this.describeError(profilesResult.reason));
      }

      if (notesResult.status === 'fulfilled') {
        this.relatedNotes.set(this.normalizeNotes(notesResult.value));
      } else {
        errors.push(this.describeError(notesResult.reason));
      }

      if (activitiesResult.status === 'fulfilled') {
        this.relatedActivities.set(this.normalizeActivities(activitiesResult.value));
      } else {
        errors.push(this.describeError(activitiesResult.reason));
      }

      this.relationsError.set(errors.length > 0 ? errors.join(' | ') : null);
    } finally {
      this.isRelationsLoading.set(false);
    }
  }

  private normalizeProfiles(payload: unknown): RelatedEntryItem[] {
    return this.extractItems(payload).map((item) => {
      const record = item as Record<string, unknown>;
      const id = this.extractId(record, ['profile_id', 'id']);
      const label = this.extractText(record, ['display_name', 'username', 'platform']) ?? 'Profile';
      const descriptionParts = [record['platform'], record['status']]
        .filter((value) => typeof value === 'string' && value.trim().length > 0) as string[];
      const note = this.extractText(record, ['note', 'relation_note', 'profile_note']);
      return {
        id,
        label,
        description: descriptionParts.join(' - '),
        routerLink: id ? ['/entries', 'profiles', id] : undefined,
        type: 'profiles',
        note
      };
    });
  }

  private normalizeNotes(payload: unknown): RelatedEntryItem[] {
    return this.extractItems(payload).map((item) => {
      const record = item as Record<string, unknown>;
      const id = this.extractId(record, ['id']);
      const label = this.extractText(record, ['title']) ?? 'Note';
      const text = this.extractText(record, ['text']);
      const snippet = text && text.length > 80 ? `${text.slice(0, 80)}...` : text;
      return {
        id,
        label,
        description: snippet,
        timestamp: this.extractText(record, ['created_at', 'updated_at']),
        routerLink: id ? ['/entries', 'notes', id] : undefined,
        type: 'notes'
      };
    });
  }

  private normalizeActivities(payload: unknown): RelatedEntryItem[] {
    return this.extractItems(payload)
      .slice(0, 25)
      .map((item) => {
      const record = item as Record<string, unknown>;
      const id = this.extractId(record, ['id']);
      const label = this.extractText(record, ['activity_type']) ?? 'Activity';
      const description = this.extractText(record, ['item', 'notes']);
      const timestamp = this.extractText(record, ['occurred_at', 'updated_at']);
      return {
        id,
        label,
        description,
        timestamp,
        routerLink: id ? ['/entries', 'activities', id] : undefined,
        type: 'activities'
      };
    });
  }

  private extractItems(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter((item) => typeof item === 'object' && item !== null) as Record<string, unknown>[];
    }

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const items = record['items'];
      if (Array.isArray(items)) {
        return items.filter((item) => typeof item === 'object' && item !== null) as Record<string, unknown>[];
      }
    }

    return [];
  }

  private extractId(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return value.toString();
      }
    }
    return undefined;
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

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }

    return this.translate.instant('entryDetail.errors.unknown');
  }

  private clearRelations(): void {
    this.relatedProfiles.set([]);
    this.relatedNotes.set([]);
    this.relatedActivities.set([]);
    this.relationsError.set(null);
    this.isRelationsLoading.set(false);
    this.profileLinkError.set(null);
    this.isManagingProfileLinks.set(false);
  }
}



