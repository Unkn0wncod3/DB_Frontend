import { inject, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
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
  metadata?: Record<string, unknown>;
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
      if (!overview) {
        console.warn('[StatsService] Received unexpected /stats/overview payload', response);
      }

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

  private normalizeOverview(payload: unknown): StatsOverview | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (this.looksLikeOverview(payload)) {
      return payload as StatsOverview;
    }

    const record = payload as Record<string, unknown>;

    const candidates = ['data', 'overview', 'result', 'payload'];
    for (const key of candidates) {
      if (key in record && this.looksLikeOverview(record[key])) {
        return record[key] as StatsOverview;
      }
    }

    return null;
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
}

