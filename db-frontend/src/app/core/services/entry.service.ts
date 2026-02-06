import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from './api.service';
import { VisibilityLevel } from '../../shared/types/visibility-level.type';

export interface EntryListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filters?: Record<string, string | number | boolean | null | undefined>;
}

export interface EntryRecord extends Record<string, unknown> {
  visibility_level?: VisibilityLevel;
}

export interface EntryListResult {
  items: EntryRecord[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  raw: unknown;
}

@Injectable({ providedIn: 'root' })
export class EntryService {
  private readonly api = inject(ApiService);
  private readonly defaultPageSize = 25;

  listEntries(type: string, params: EntryListParams = {}): Observable<EntryListResult> {
    const page = this.normalizePage(params.page ?? 1);
    const pageSize = this.normalizePageSize(params.pageSize ?? this.defaultPageSize);
    const query = this.buildListQuery(params, page, pageSize);

    return this.api
      .request<unknown>('GET', this.buildCollectionEndpoint(type), { params: query })
      .pipe(map((payload) => this.normalizeListResponse(payload, page, pageSize)));
  }

  getEntry(type: string, id: string): Observable<EntryRecord> {
    return this.api.request<EntryRecord>('GET', this.buildItemEndpoint(type, id));
  }

  createEntry(type: string, payload: Record<string, unknown>): Observable<EntryRecord> {
    const normalizedType = type?.trim().toLowerCase();
    if (normalizedType === 'notes' && payload && 'person_id' in payload) {
      const personId = this.extractPersonId(payload['person_id']);
      if (!personId) {
        throw new Error('Person ID is required');
      }
      const { person_id: _omit, ...notePayload } = payload;
      return this.createNoteForPerson(personId, notePayload);
    }

    return this.api.request<EntryRecord>('POST', this.buildCollectionEndpoint(type), {
      body: payload
    });
  }

  createNoteForPerson(personId: string, payload: Record<string, unknown>): Observable<EntryRecord> {
    const sanitizedId = this.extractPersonId(personId);
    if (!sanitizedId) {
      throw new Error('Person ID is required');
    }

    return this.api.request<EntryRecord>(
      'POST',
      `/notes/by-person/${encodeURIComponent(sanitizedId)}`,
      { body: payload }
    );
  }

  private extractPersonId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  }

  updateEntry(type: string, id: string, payload: Record<string, unknown>): Observable<EntryRecord> {
    return this.api.request<EntryRecord>('PATCH', this.buildItemEndpoint(type, id), {
      body: payload
    });
  }

  deleteEntry(type: string, id: string): Observable<unknown> {
    return this.api.request('DELETE', this.buildItemEndpoint(type, id));
  }

  private buildListQuery(params: EntryListParams, page: number, pageSize: number): Record<string, string> {
    const query: Record<string, string> = {
      page: page.toString(),
      limit: pageSize.toString(),
      pageSize: pageSize.toString(),
      perPage: pageSize.toString()
    };

    const search = params.search?.trim();
    if (search && search.length > 0) {
      query['search'] = search;
      query['q'] = search;
    }

    const filters = params.filters;
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }
        const stringValue = String(value);
        query[`filter[${key}]`] = stringValue;
        query[key] = stringValue;
      }
    }

    return query;
  }

  private buildCollectionEndpoint(type: string): string {
    const sanitizedType = this.sanitizeType(type);
    if (!sanitizedType) {
      throw new Error('Entry type is required');
    }
    return `/${sanitizedType}`;
  }

  private buildItemEndpoint(type: string, id: string): string {
    const collectionEndpoint = this.buildCollectionEndpoint(type);
    const sanitizedId = id.trim();

    if (!sanitizedId) {
      throw new Error('Entry id is required');
    }

    return `${collectionEndpoint}/${encodeURIComponent(sanitizedId)}`;
  }

  private sanitizeType(type: string): string {
    return type
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join('/');
  }

  private normalizeListResponse(payload: unknown, page: number, pageSize: number): EntryListResult {
    const result: EntryListResult = {
      items: [],
      total: null,
      page,
      pageSize,
      hasMore: false,
      raw: payload
    };

    if (Array.isArray(payload)) {
      result.items = this.toRecordList(payload);
      result.total = result.items.length;
      result.hasMore = result.items.length === pageSize;
      return result;
    }

    if (!payload || typeof payload !== 'object') {
      return result;
    }

    const record = payload as Record<string, unknown>;

    const itemKeys = ['items', 'results', 'data', 'entries', 'records', 'rows'];
    for (const key of itemKeys) {
      const value = record[key];
      if (Array.isArray(value)) {
        result.items = this.toRecordList(value);
        break;
      }
      if (value && typeof value === 'object') {
        const nested = (value as Record<string, unknown>)['data'];
        if (Array.isArray(nested)) {
          result.items = this.toRecordList(nested);
          break;
        }
      }
    }

    const totalSources = [
      record['total'],
      record['totalCount'],
      record['totalItems'],
      record['total_items'],
      record['count'],
      this.extractNestedNumber(record['meta'], ['total', 'count']),
      this.extractNestedNumber(record['pagination'], ['total', 'count'])
    ];
    for (const source of totalSources) {
      const parsed = this.toNumber(source);
      if (parsed != null) {
        result.total = parsed;
        break;
      }
    }

    const pageSources = [
      record['page'],
      record['currentPage'],
      record['pageIndex'],
      this.extractNestedNumber(record['meta'], ['page', 'currentPage']),
      this.extractNestedNumber(record['pagination'], ['page'])
    ];
    for (const source of pageSources) {
      const parsed = this.toNumber(source);
      if (parsed != null) {
        result.page = this.normalizePage(parsed);
        break;
      }
    }

    const pageSizeSources = [
      record['pageSize'],
      record['limit'],
      record['perPage'],
      record['page_size'],
      this.extractNestedNumber(record['meta'], ['pageSize', 'perPage', 'limit']),
      this.extractNestedNumber(record['pagination'], ['pageSize', 'perPage', 'limit'])
    ];
    for (const source of pageSizeSources) {
      const parsed = this.toNumber(source);
      if (parsed != null) {
        result.pageSize = this.normalizePageSize(parsed);
        break;
      }
    }

    if (result.items.length === 0 && record['data'] && typeof record['data'] === 'object') {
      const data = record['data'] as Record<string, unknown>;
      for (const value of Object.values(data)) {
        if (Array.isArray(value)) {
          result.items = this.toRecordList(value);
          break;
        }
      }
    }

    if (result.total != null) {
      result.hasMore = result.page * result.pageSize < result.total;
    } else {
      result.hasMore = result.items.length === result.pageSize;
    }

    return result;
  }

  private toRecordList(source: unknown[]): EntryRecord[] {
    return source.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return item as EntryRecord;
      }
      return { value: item } as EntryRecord;
    });
  }

  private extractNestedNumber(source: unknown, keys: string[]): number | null {
    if (!source || typeof source !== 'object') {
      return null;
    }

    const record = source as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      const parsed = this.toNumber(value);
      if (parsed != null) {
        return parsed;
      }
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizePage(value: number): number {
    return Math.max(1, Math.trunc(value || 1));
  }

  private normalizePageSize(value: number): number {
    return Math.max(1, Math.min(200, Math.trunc(value || this.defaultPageSize)));
  }
}
