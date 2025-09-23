import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';

export interface StatsOverviewRecord {
  id?: string;
  title?: string;
  name?: string;
  summary?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StatsOverviewMetadata {
  generatedAt?: string;
  expiresAt?: string;
  raw?: unknown;
  [key: string]: unknown;
}

export interface StatsOverview {
  totals?: Record<string, number>;
  activity?: Record<string, number>;
  latest?: {
    created?: StatsOverviewRecord;
    updated?: StatsOverviewRecord;
  };
  recent?: StatsOverviewRecord[];
  metadata?: StatsOverviewMetadata;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private readonly api = inject(ApiService);

  private readonly overviewSignal = signal<StatsOverview | null>(null);
  private readonly errorSignal = signal<HttpErrorResponse | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly lastUpdatedSignal = signal<number | null>(null);

  private readonly ttlMs = 20 * 60 * 1000; // 20 minutes
  private readonly maxRecentItems = 12;

  readonly overview = this.overviewSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly isLoading = this.loadingSignal.asReadonly();
  readonly lastUpdated = this.lastUpdatedSignal.asReadonly();

  async loadOverview(forceRefresh = false): Promise<void> {
    const now = Date.now();
    const lastUpdated = this.lastUpdatedSignal();
    const hasFreshData = !forceRefresh && !!this.overviewSignal() && !!lastUpdated && now - lastUpdated < this.ttlMs;

    if (hasFreshData) {
      return;
    }

    this.loadingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const response = await firstValueFrom(
        this.api.request<unknown>('GET', '/stats/overview')
      );

      const overview = this.normalizeOverview(response);
      this.overviewSignal.set(overview);
      this.lastUpdatedSignal.set(Date.now());
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        this.errorSignal.set(error);
      } else {
        this.errorSignal.set(
          new HttpErrorResponse({
            status: 0,
            statusText: 'Unknown Error',
            error
          })
        );
      }
    } finally {
      this.loadingSignal.set(false);
    }
  }

  private normalizeOverview(payload: unknown): StatsOverview {
    const normalized = this.tryNormalizeOverview(payload);
    const metadata: StatsOverviewMetadata = {
      ...(normalized.metadata ?? {}),
      raw: payload
    };

    return {
      ...normalized,
      metadata
    };
  }

  private tryNormalizeOverview(payload: unknown): StatsOverview {
    if (!payload || typeof payload !== 'object') {
      return {};
    }

    if (this.looksLikeOverview(payload)) {
      return payload as StatsOverview;
    }

    const record = payload as Record<string, unknown>;

    const nestedKeys = ['data', 'overview', 'result', 'payload'];
    for (const key of nestedKeys) {
      if (key in record) {
        const nested = this.tryNormalizeOverview(record[key]);
        if (Object.keys(nested).length > 0) {
          return nested;
        }
      }
    }

    const converted = this.createOverviewFromEntities(record);
    if (converted) {
      return converted;
    }

    return {};
  }

  private looksLikeOverview(candidate: unknown): candidate is StatsOverview {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }

    const record = candidate as Record<string, unknown>;

    return (
      ('totals' in record && typeof record['totals'] === 'object') ||
      ('activity' in record && typeof record['activity'] === 'object') ||
      ('latest' in record && typeof record['latest'] === 'object') ||
      ('recent' in record && Array.isArray(record['recent']))
    );
  }

  private createOverviewFromEntities(record: Record<string, unknown>): StatsOverview | null {
    const entitiesRaw = record['entities'];
    if (!entitiesRaw || typeof entitiesRaw !== 'object') {
      return null;
    }

    const entities = entitiesRaw as Record<string, unknown>;
    const totals: Record<string, number> = {};
    const metadata: StatsOverviewMetadata = {};

    const metaRaw = record['meta'];
    if (metaRaw && typeof metaRaw === 'object') {
      const metaObj = metaRaw as Record<string, unknown>;
      if (typeof metaObj['generated_at'] === 'string') {
        metadata.generatedAt = metaObj['generated_at'] as string;
      }
      if (typeof metaObj['expires_at'] === 'string') {
        metadata.expiresAt = metaObj['expires_at'] as string;
      }
      metadata['meta'] = metaObj;
    }

    let latestCreated: StatsOverviewRecord | undefined;
    let latestCreatedValue = Number.NEGATIVE_INFINITY;
    let latestUpdated: StatsOverviewRecord | undefined;
    let latestUpdatedValue = Number.NEGATIVE_INFINITY;

    for (const [key, value] of Object.entries(entities)) {
      if (!value || typeof value !== 'object') {
        continue;
      }

      const entity = value as Record<string, unknown>;
      const total = this.toNumber(entity['total'] ?? entity['count'] ?? entity['total_count']);
      if (typeof total === 'number') {
        totals[key] = total;
      }

      const createdInfo = this.parseDate(entity['last_created_at']);
      if (createdInfo && createdInfo.value > latestCreatedValue) {
        latestCreatedValue = createdInfo.value;
        latestCreated = this.buildEntityRecord(key, entity, {
          createdAt: createdInfo.iso,
          updatedAt: this.parseDate(entity['last_updated_at'])?.iso
        });
      }

      const updatedInfo = this.parseDate(entity['last_updated_at']);
      if (updatedInfo && updatedInfo.value > latestUpdatedValue) {
        latestUpdatedValue = updatedInfo.value;
        latestUpdated = this.buildEntityRecord(key, entity, {
          createdAt: this.parseDate(entity['last_created_at'])?.iso,
          updatedAt: updatedInfo.iso
        });
      }
    }

    const recent = this.extractRecentRecords(record['recent']);

    if (Object.keys(totals).length === 0 && recent.length === 0 && !latestCreated && !latestUpdated) {
      return null;
    }

    const overview: StatsOverview = {
      totals: Object.keys(totals).length > 0 ? totals : undefined,
      latest: (latestCreated || latestUpdated)
        ? {
            created: latestCreated,
            updated: latestUpdated
          }
        : undefined,
      recent: recent.length > 0 ? recent : undefined,
      metadata
    };

    return overview;
  }

  private extractRecentRecords(source: unknown): StatsOverviewRecord[] {
    if (!source || typeof source !== 'object') {
      return [];
    }

    const bucket = source as Record<string, unknown>;
    const results: StatsOverviewRecord[] = [];

    for (const [type, value] of Object.entries(bucket)) {
      if (!Array.isArray(value)) {
        continue;
      }

      for (const item of value) {
        if (!item || typeof item !== 'object') {
          continue;
        }

        const record = item as Record<string, unknown>;
        results.push({
          id: this.toId(record),
          title: this.pickText(record, ['title', 'name', 'label']),
          summary: this.pickText(record, ['summary', 'description']),
          type,
          createdAt: this.pickDateString(record, ['created_at', 'createdAt', 'timestamp']),
          updatedAt: this.pickDateString(record, ['updated_at', 'updatedAt']),
          metadata: record
        });

        if (results.length >= this.maxRecentItems) {
          return results;
        }
      }
    }

    return results;
  }

  private buildEntityRecord(
    type: string,
    entity: Record<string, unknown>,
    overrides: Partial<StatsOverviewRecord>
  ): StatsOverviewRecord {
    return {
      id: type,
      title: this.humanizeKey(type),
      type,
      createdAt: overrides.createdAt ?? this.parseDate(entity['last_created_at'])?.iso,
      updatedAt: overrides.updatedAt ?? this.parseDate(entity['last_updated_at'])?.iso,
      summary: this.pickText(entity, ['summary', 'description']),
      metadata: entity
    };
  }

  private toNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseDate(value: unknown): { value: number; iso: string } | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return null;
    }

    return { value: timestamp, iso: new Date(timestamp).toISOString() };
  }

  private pickText(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private pickDateString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const parsed = this.parseDate(record[key]);
      if (parsed) {
        return parsed.iso;
      }
    }
    return undefined;
  }

  private toId(record: Record<string, unknown>): string | undefined {
    const value = record['id'] ?? record['_id'];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    return undefined;
  }

  private humanizeKey(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
