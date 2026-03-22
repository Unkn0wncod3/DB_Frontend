import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiService } from './api.service';

export interface DashboardEntrySummary {
  id: string | number;
  schema_id: string | number;
  schema_key: string;
  schema_name: string;
  title: string;
  status?: string | null;
  visibility_level: string;
  owner_id?: string | number | null;
  created_at: string;
  updated_at?: string | null;
}

export interface DashboardSchemaTotal {
  schema_id: string | number;
  schema_key: string;
  schema_name: string;
  icon?: string | null;
  total_entries: number;
  last_created_at?: string | null;
  last_updated_at?: string | null;
}

export interface DashboardResponse {
  total_entries: number;
  latest_created: DashboardEntrySummary[];
  latest_updated: DashboardEntrySummary[];
  totals_per_schema: DashboardSchemaTotal[];
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private readonly api = inject(ApiService);

  private readonly overviewSignal = signal<DashboardResponse | null>(null);
  private readonly errorSignal = signal<HttpErrorResponse | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly lastUpdatedSignal = signal<number | null>(null);

  private readonly ttlMs = 5 * 60 * 1000;

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
      const response = await firstValueFrom(this.api.request<DashboardResponse>('GET', '/dashboard'));
      this.overviewSignal.set(this.normalizeDashboard(response));
      this.lastUpdatedSignal.set(Date.now());
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        this.errorSignal.set(error);
      } else if (error instanceof Error) {
        this.errorSignal.set(
          new HttpErrorResponse({
            status: 0,
            statusText: error.message || 'Unknown Error',
            error
          })
        );
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

  private normalizeDashboard(payload: DashboardResponse | null | undefined): DashboardResponse {
    return {
      total_entries: typeof payload?.total_entries === 'number' ? payload.total_entries : 0,
      latest_created: Array.isArray(payload?.latest_created) ? payload!.latest_created.slice(0, 5) : [],
      latest_updated: Array.isArray(payload?.latest_updated) ? payload!.latest_updated.slice(0, 5) : [],
      totals_per_schema: Array.isArray(payload?.totals_per_schema) ? payload!.totals_per_schema : []
    };
  }
}
