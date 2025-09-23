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
        this.api.request<StatsOverview>('GET', '/stats/overview')
      );

      this.overviewSignal.set(response);
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
}
