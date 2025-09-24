import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class EntryService {
  private readonly api = inject(ApiService);

  getEntry(type: string, id: string): Observable<Record<string, unknown>> {
    return this.api.request<Record<string, unknown>>('GET', this.buildEndpoint(type, id));
  }

  updateEntry(type: string, id: string, payload: Record<string, unknown>): Observable<Record<string, unknown>> {
    return this.api.request<Record<string, unknown>>('PATCH', this.buildEndpoint(type, id), {
      body: payload
    });
  }

  deleteEntry(type: string, id: string): Observable<unknown> {
    return this.api.request('DELETE', this.buildEndpoint(type, id));
  }

  private buildEndpoint(type: string, id: string): string {
    const sanitizedType = type
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join('/');

    const sanitizedId = id.trim();

    if (!sanitizedType) {
      throw new Error('Entry type is required');
    }

    if (!sanitizedId) {
      throw new Error('Entry id is required');
    }

    return `/${sanitizedType}/${encodeURIComponent(sanitizedId)}`;
  }
}
