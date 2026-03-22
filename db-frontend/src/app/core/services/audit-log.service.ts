import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from './api.service';

export interface AuditLogRecord {
  id: string | number;
  action: string;
  resource: string;
  created_at: string;
  user_id?: number | string | null;
  username?: string | null;
  role?: string | null;
  method?: string | null;
  path?: string | null;
  status_code?: number | null;
  ip_address?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditLogList {
  items: AuditLogRecord[];
  total: number;
  next_offset?: number;
}

export interface AuditLogListParams {
  limit?: number;
  offset?: number;
  user_id?: number;
  action?: string;
  resource?: string;
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  private readonly api = inject(ApiService);

  listLogs(params: AuditLogListParams = {}): Observable<AuditLogList> {
    const query: Record<string, string | number | boolean> = {};
    if (typeof params.limit === 'number') {
      query['limit'] = params.limit;
    }
    if (typeof params.offset === 'number') {
      query['offset'] = params.offset;
    }
    if (typeof params.user_id === 'number') {
      query['user_id'] = params.user_id;
    }
    if (params.action) {
      query['action'] = params.action;
    }
    if (params.resource) {
      query['resource'] = params.resource;
    }

    return this.api
      .request<unknown>('GET', '/audit/logs', { params: query })
      .pipe(map(this.normalizeResponse));
  }

  private normalizeResponse = (payload: unknown): AuditLogList => {
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const items = Array.isArray(record['items'])
        ? (record['items'] as unknown[])
        : Array.isArray(record['results'])
          ? (record['results'] as unknown[])
          : Array.isArray(record['data'])
            ? (record['data'] as unknown[])
            : Array.isArray(record)
              ? (record as unknown[])
              : [];
      const total =
        typeof record['total'] === 'number'
          ? record['total']
          : Array.isArray(items)
            ? items.length
            : 0;
      const nextOffset =
        typeof record['next_offset'] === 'number'
          ? record['next_offset']
          : typeof record['nextOffset'] === 'number'
            ? record['nextOffset']
            : undefined;
      return {
        items: this.normalizeItems(items),
        total,
        next_offset: nextOffset
      };
    }
    if (Array.isArray(payload)) {
      return {
        items: this.normalizeItems(payload),
        total: payload.length
      };
    }
    return { items: [], total: 0 };
  };

  private normalizeItems(items: unknown[]): AuditLogRecord[] {
    return items
      .map((item) => this.normalizeLog(item))
      .filter((entry): entry is AuditLogRecord => entry !== null);
  }

  private normalizeLog(candidate: unknown): AuditLogRecord | null {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }
    const record = candidate as Record<string, unknown>;
    const id = record['id'] ?? record['_id'];
    const createdAt = record['created_at'] ?? record['timestamp'] ?? record['occurred_at'];
    const action = record['action'] ?? record['event'] ?? '';
    const resource = record['resource'] ?? record['target'] ?? '';
    if (!id || !createdAt || !action) {
      return null;
    }

    const metadata = record['metadata'];
    const method = typeof record['method'] === 'string' ? record['method'] : this.extractMethod(String(action));
    const path = typeof record['path'] === 'string' ? record['path'] : this.extractPath(String(action));
    const status =
      typeof record['status_code'] === 'number'
        ? record['status_code']
        : typeof record['status'] === 'number'
          ? record['status']
          : undefined;
    return {
      id: typeof id === 'string' || typeof id === 'number' ? id : String(id),
      action: String(action),
      resource: String(resource ?? ''),
      created_at: typeof createdAt === 'string' ? createdAt : new Date(createdAt as number).toISOString(),
      user_id: typeof record['user_id'] === 'number' ? record['user_id'] : undefined,
      username: typeof record['username'] === 'string' ? record['username'] : undefined,
      role: typeof record['role'] === 'string' ? record['role'] : undefined,
      method: method ?? null,
      path: path ?? null,
      status_code: status ?? null,
      ip_address: typeof record['ip'] === 'string' ? record['ip'] : typeof record['ip_address'] === 'string' ? record['ip_address'] : undefined,
      metadata: typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : null
    };
  }

  deleteLogs(): Observable<void> {
    return this.api.request<void>('DELETE', '/audit/logs');
  }

  private extractMethod(action: string): string | null {
    if (!action) {
      return null;
    }
    const parts = action.trim().split(/\s+/);
    if (parts.length > 1 && parts[0].length <= 10) {
      return parts[0].toUpperCase();
    }
    return null;
  }

  private extractPath(action: string): string | null {
    if (!action) {
      return null;
    }
    const spaceIndex = action.indexOf(' ');
    if (spaceIndex >= 0) {
      return action.slice(spaceIndex + 1).trim();
    }
    return null;
  }
}
