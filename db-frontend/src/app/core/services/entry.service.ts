import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';

import { ApiService } from './api.service';
import { SchemaService } from './schema.service';
import {
  AttachmentRecord,
  CreateEntryPayload,
  EntryAccessMap,
  EntryHistoryRecord,
  EntryListParams,
  EntryPermission,
  EntryPermissionRecord,
  EntryRecord,
  EntryRelationRecord,
  UpdateEntryPayload
} from '../models/metadata.models';

export type { EntryListParams } from '../models/metadata.models';

export interface LegacyEntryListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filters?: Record<string, string | number | boolean | null | undefined>;
}

export interface LegacyEntryListResult {
  items: Record<string, unknown>[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  raw: unknown;
}

const ENTRY_PERMISSIONS: EntryPermission[] = [
  'read',
  'view_history',
  'edit',
  'edit_status',
  'edit_visibility',
  'manage_relations',
  'manage_attachments',
  'manage_permissions',
  'delete',
  'manage'
];

@Injectable({ providedIn: 'root' })
export class EntryService {
  private readonly api = inject(ApiService);
  private readonly schemaService = inject(SchemaService);

  listEntries(params: EntryListParams): Observable<EntryRecord[]>;
  listEntries(schemaKey: string, params?: LegacyEntryListParams): Observable<LegacyEntryListResult>;
  listEntries(typeOrParams: string | EntryListParams, legacyParams?: LegacyEntryListParams): Observable<EntryRecord[] | LegacyEntryListResult> {
    if (typeof typeOrParams === 'string') {
      return this.schemaService.loadSchemas().pipe(
        switchMap((schemas) => {
          const schema = schemas.find((item) => item.key === typeOrParams) ?? null;
          if (!schema) {
            throw new Error(`Unknown schema: ${typeOrParams}`);
          }
          return this.listEntries({ schema_id: schema.id }).pipe(
            map((entries) => ({
              items: entries as unknown as Record<string, unknown>[],
              total: entries.length,
              page: legacyParams?.page ?? 1,
              pageSize: legacyParams?.pageSize ?? entries.length,
              hasMore: false,
              raw: entries
            }))
          );
        })
      );
    }

    return this.api.request<EntryRecord[]>('GET', '/entries', { params: this.compactParams(typeOrParams) });
  }

  getEntry(entryId: string | number): Observable<EntryRecord>;
  getEntry(_schemaKey: string, entryId: string | number): Observable<EntryRecord>;
  getEntry(entryIdOrSchemaKey: string | number, maybeEntryId?: string | number): Observable<EntryRecord> {
    const entryId = maybeEntryId ?? entryIdOrSchemaKey;
    return this.api.request<EntryRecord>('GET', `/entries/${encodeURIComponent(String(entryId))}`);
  }

  createEntry(payload: CreateEntryPayload): Observable<EntryRecord> {
    return this.api.request<EntryRecord>('POST', '/entries', { body: payload });
  }

  updateEntry(entryId: string | number, payload: UpdateEntryPayload): Observable<EntryRecord>;
  updateEntry(_schemaKey: string, entryId: string | number, payload: UpdateEntryPayload): Observable<EntryRecord>;
  updateEntry(entryIdOrSchemaKey: string | number, payloadOrEntryId: UpdateEntryPayload | string | number, maybePayload?: UpdateEntryPayload): Observable<EntryRecord> {
    const entryId = maybePayload ? payloadOrEntryId : entryIdOrSchemaKey;
    const payload = maybePayload ?? (payloadOrEntryId as UpdateEntryPayload);
    return this.api.request<EntryRecord>('PATCH', `/entries/${encodeURIComponent(String(entryId))}`, { body: payload });
  }

  softDeleteEntry(entryId: string | number, comment?: string): Observable<EntryRecord> {
    return this.updateEntry(entryId, {
      deleted_at: new Date().toISOString(),
      comment: comment?.trim() || 'Deleted from UI'
    });
  }

  deleteEntry(entryId: string | number): Observable<EntryRecord>;
  deleteEntry(_schemaKey: string, entryId: string | number): Observable<EntryRecord>;
  deleteEntry(entryIdOrSchemaKey: string | number, maybeEntryId?: string | number): Observable<EntryRecord> {
    const entryId = maybeEntryId ?? entryIdOrSchemaKey;
    return this.softDeleteEntry(entryId);
  }

  getHistory(entryId: string | number): Observable<EntryHistoryRecord[]> {
    return this.api.request<EntryHistoryRecord[]>('GET', `/entries/${encodeURIComponent(String(entryId))}/history`);
  }

  getRelations(entryId: string | number): Observable<EntryRelationRecord[]> {
    return this.api.request<EntryRelationRecord[]>('GET', `/entries/${encodeURIComponent(String(entryId))}/relations`);
  }

  createRelation(entryId: string | number, payload: Partial<EntryRelationRecord>): Observable<EntryRelationRecord> {
    return this.api.request<EntryRelationRecord>('POST', `/entries/${encodeURIComponent(String(entryId))}/relations`, {
      body: payload
    });
  }

  getPermissions(entryId: string | number): Observable<EntryPermissionRecord[]> {
    return this.api.request<EntryPermissionRecord[]>('GET', `/entries/${encodeURIComponent(String(entryId))}/permissions`);
  }

  createPermission(entryId: string | number, payload: Partial<EntryPermissionRecord>): Observable<EntryPermissionRecord> {
    return this.api.request<EntryPermissionRecord>('POST', `/entries/${encodeURIComponent(String(entryId))}/permissions`, {
      body: payload
    });
  }

  getAttachments(entryId: string | number): Observable<AttachmentRecord[]> {
    return this.api.request<AttachmentRecord[]>('GET', `/entries/${encodeURIComponent(String(entryId))}/attachments`);
  }

  createAttachment(entryId: string | number, payload: Partial<AttachmentRecord>): Observable<AttachmentRecord> {
    return this.api.request<AttachmentRecord>('POST', `/entries/${encodeURIComponent(String(entryId))}/attachments`, {
      body: payload
    });
  }

  checkAccess(entryId: string | number, permission: EntryPermission): Observable<boolean> {
    return this.api
      .request<unknown>('GET', `/entries/${encodeURIComponent(String(entryId))}/access/${permission}`)
      .pipe(map((payload) => this.normalizeBooleanResponse(payload)));
  }

  loadAccessMap(entryId: string | number): Observable<EntryAccessMap> {
    if (entryId == null || entryId === '') {
      return of(this.emptyAccessMap());
    }

    const requests = Object.fromEntries(
      ENTRY_PERMISSIONS.map((permission) => [
        permission,
        this.checkAccess(entryId, permission)
      ])
    ) as Record<EntryPermission, Observable<boolean>>;

    return forkJoin(requests).pipe(map((result) => ({ ...this.emptyAccessMap(), ...result })));
  }

  private normalizeBooleanResponse(payload: unknown): boolean {
    if (typeof payload === 'boolean') {
      return payload;
    }
    if (typeof payload === 'number') {
      return payload !== 0;
    }
    if (typeof payload === 'string') {
      return ['true', '1', 'yes'].includes(payload.trim().toLowerCase());
    }
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const candidate = record['allowed'] ?? record['has_access'] ?? record['access'] ?? record['result'];
      return this.normalizeBooleanResponse(candidate);
    }
    return false;
  }

  private compactParams(params: EntryListParams): Record<string, string> {
    return Object.entries(params).reduce<Record<string, string>>((result, [key, value]) => {
      if (value === null || value === undefined || value === '') {
        return result;
      }
      result[key] = String(value);
      return result;
    }, {});
  }

  private emptyAccessMap(): EntryAccessMap {
    return {
      read: false,
      view_history: false,
      edit: false,
      edit_status: false,
      edit_visibility: false,
      manage_relations: false,
      manage_attachments: false,
      manage_permissions: false,
      delete: false,
      manage: false
    };
  }
}
