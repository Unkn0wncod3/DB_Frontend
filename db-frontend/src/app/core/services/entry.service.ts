import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';

import { ApiService } from './api.service';
import { SchemaService } from './schema.service';
import {
  AttachmentRecord,
  CreateEntryPayload,
  EntryAccessMap,
  EntryBundle,
  EntryHistoryRecord,
  GlobalHistoryListParams,
  GlobalHistoryListResponse,
  EntryLookupParams,
  EntryLookupRecord,
  EntryListParams,
  EntryPermission,
  EntryPermissionRecord,
  EntryRecord,
  EntryRecordWithAccess,
  EntryRelationRecord,
  EntryRelationTreeResponse,
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
          const schema = this.schemaService.resolveSchemaByKey(typeOrParams, schemas);
          if (!schema) {
            throw new Error(`Unknown schema: ${typeOrParams}`);
          }
          return this.schemaService.getSchemaEntries(schema.id).pipe(
            map((response) => {
              const filtered = this.filterLegacyEntries(response.entries, legacyParams);
              const page = Math.max(legacyParams?.page ?? 1, 1);
              const requestedPageSize = legacyParams?.pageSize ?? (filtered.length > 0 ? filtered.length : 1);
              const pageSize = Math.max(requestedPageSize, 1);
              const startIndex = (page - 1) * pageSize;
              const items = filtered.slice(startIndex, startIndex + pageSize);
              return {
                items: items.map((entry) => this.flattenLegacyEntry(entry)),
                total: filtered.length,
                page,
                pageSize,
                hasMore: startIndex + pageSize < filtered.length,
                raw: response
              };
            })
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

  getEntryBundle(entryId: string | number): Observable<EntryBundle> {
    return this.api.request<EntryBundle>('GET', `/entries/${encodeURIComponent(String(entryId))}/bundle`);
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

  getGlobalHistory(params: GlobalHistoryListParams = {}): Observable<GlobalHistoryListResponse> {
    const query = Object.entries(params).reduce<Record<string, string>>((result, [key, value]) => {
      if (value === null || value === undefined || value === '') {
        return result;
      }
      result[key] = String(value);
      return result;
    }, {});

    return this.api.request<GlobalHistoryListResponse>('GET', '/history', { params: query });
  }

  getRelations(entryId: string | number): Observable<EntryRelationRecord[]> {
    return this.api.request<EntryRelationRecord[]>('GET', `/entries/${encodeURIComponent(String(entryId))}/relations`);
  }

  getRelationTree(entryId: string | number): Observable<EntryRelationTreeResponse> {
    return this.api.request<EntryRelationTreeResponse>('GET', `/entries/${encodeURIComponent(String(entryId))}/relation-tree`);
  }

  lookupEntries(params: EntryLookupParams = {}): Observable<EntryLookupRecord[]> {
    return this.api.request<EntryLookupRecord[]>('GET', '/entries/lookup', { params: this.compactParams(params) });
  }

  createRelation(entryId: string | number, payload: Partial<EntryRelationRecord>): Observable<EntryRelationRecord> {
    return this.api.request<EntryRelationRecord>('POST', `/entries/${encodeURIComponent(String(entryId))}/relations`, {
      body: payload
    });
  }

  updateRelation(entryId: string | number, relationId: string | number, payload: Partial<EntryRelationRecord>): Observable<EntryRelationRecord> {
    return this.api.request<EntryRelationRecord>(
      'PATCH',
      `/entries/${encodeURIComponent(String(entryId))}/relations/${encodeURIComponent(String(relationId))}`,
      { body: payload }
    );
  }

  deleteRelation(entryId: string | number, relationId: string | number): Observable<EntryRelationRecord> {
    return this.api.request<EntryRelationRecord>(
      'DELETE',
      `/entries/${encodeURIComponent(String(entryId))}/relations/${encodeURIComponent(String(relationId))}`
    );
  }

  getPermissions(entryId: string | number): Observable<EntryPermissionRecord[]> {
    return this.api.request<EntryPermissionRecord[]>('GET', `/entries/${encodeURIComponent(String(entryId))}/permissions`);
  }

  createPermission(entryId: string | number, payload: Partial<EntryPermissionRecord>): Observable<EntryPermissionRecord> {
    return this.api.request<EntryPermissionRecord>('POST', `/entries/${encodeURIComponent(String(entryId))}/permissions`, {
      body: payload
    });
  }

  updatePermission(entryId: string | number, permissionId: string | number, payload: Partial<EntryPermissionRecord>): Observable<EntryPermissionRecord> {
    return this.api.request<EntryPermissionRecord>(
      'PATCH',
      `/entries/${encodeURIComponent(String(entryId))}/permissions/${encodeURIComponent(String(permissionId))}`,
      { body: payload }
    );
  }

  deletePermission(entryId: string | number, permissionId: string | number): Observable<EntryPermissionRecord> {
    return this.api.request<EntryPermissionRecord>(
      'DELETE',
      `/entries/${encodeURIComponent(String(entryId))}/permissions/${encodeURIComponent(String(permissionId))}`
    );
  }

  getAttachments(entryId: string | number): Observable<AttachmentRecord[]> {
    return this.api.request<AttachmentRecord[]>('GET', `/entries/${encodeURIComponent(String(entryId))}/attachments`);
  }

  createAttachment(entryId: string | number, payload: Partial<AttachmentRecord>): Observable<AttachmentRecord> {
    return this.api.request<AttachmentRecord>('POST', `/entries/${encodeURIComponent(String(entryId))}/attachments`, {
      body: payload
    });
  }

  updateAttachment(entryId: string | number, attachmentId: string | number, payload: Partial<AttachmentRecord>): Observable<AttachmentRecord> {
    return this.api.request<AttachmentRecord>(
      'PATCH',
      `/entries/${encodeURIComponent(String(entryId))}/attachments/${encodeURIComponent(String(attachmentId))}`,
      { body: payload }
    );
  }

  deleteAttachment(entryId: string | number, attachmentId: string | number): Observable<AttachmentRecord> {
    return this.api.request<AttachmentRecord>(
      'DELETE',
      `/entries/${encodeURIComponent(String(entryId))}/attachments/${encodeURIComponent(String(attachmentId))}`
    );
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

  private filterLegacyEntries(entries: EntryRecordWithAccess[], params?: LegacyEntryListParams): EntryRecordWithAccess[] {
    if (!params?.search && !params?.filters) {
      return entries;
    }

    const search = params.search?.trim().toLowerCase() ?? '';
    const filters = params.filters ?? {};

    return entries.filter((entry) => {
      if (search) {
        const haystack = [
          entry.id,
          entry.title,
          entry.status,
          entry.visibility_level,
          ...Object.values(entry.data_json ?? {})
        ]
          .filter((value) => value != null)
          .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      for (const [key, expected] of Object.entries(filters)) {
        if (expected == null || expected === '') {
          continue;
        }
        const actual = this.readLegacyField(entry, key);
        if (actual == null) {
          return false;
        }
        if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
          return false;
        }
      }

      return true;
    });
  }

  private flattenLegacyEntry(entry: EntryRecordWithAccess): Record<string, unknown> {
    return {
      id: entry.id,
      schema_id: entry.schema_id,
      title: entry.title,
      status: entry.status ?? null,
      visibility_level: entry.visibility_level,
      owner_id: entry.owner_id ?? null,
      created_by: entry.created_by ?? null,
      created_at: entry.created_at ?? null,
      updated_at: entry.updated_at ?? null,
      archived_at: entry.archived_at ?? null,
      deleted_at: entry.deleted_at ?? null,
      access: entry.access ?? null,
      ...(entry.data_json ?? {})
    };
  }

  private readLegacyField(entry: EntryRecordWithAccess, key: string): unknown {
    const data = entry.data_json ?? {};
    const aliases: Record<string, unknown> = {
      person_id: data['person_id'] ?? data['owner_person_id'],
      profile_id: data['profile_id'],
      platform_id: data['platform_id'],
      notes: data['notes'] ?? data['description'],
      item: data['summary'] ?? entry.title
    };

    if (key in aliases) {
      return aliases[key];
    }

    if (key in entry) {
      return (entry as unknown as Record<string, unknown>)[key];
    }

    return data[key];
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
