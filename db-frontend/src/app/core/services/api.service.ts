import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../tokens/api-base-url.token';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  headers?: HttpHeaders | Record<string, string>;
  params?: HttpParams | Record<string, string | number | boolean | readonly (string | number | boolean)[]>;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  request<T>(method: HttpMethod, endpoint: string, options: RequestOptions = {}): Observable<T> {
    const url = this.buildUrl(endpoint);
    const { body, headers, params } = options;
    return this.http.request<T>(method, url, { body, headers, params });
  }

  private buildUrl(endpoint: string): string {
    const normalizedBase = this.baseUrl.replace(/\/+$/, '');
    const sanitizedEndpoint = (endpoint ?? '').trim();
    if (!sanitizedEndpoint) {
      return normalizedBase;
    }

    const normalizedEndpoint = sanitizedEndpoint.startsWith('/')
      ? sanitizedEndpoint
      : `/${sanitizedEndpoint}`;

    return `${normalizedBase}${normalizedEndpoint}`;
  }
}
