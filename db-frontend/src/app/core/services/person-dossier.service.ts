import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { API_BASE_URL } from '../tokens/api-base-url.token';
import {
  PersonDossierLimits,
  PersonDossierPdfSnapshot,
  PersonDossierResponse,
  PersonDossierSnapshot
} from '../../shared/types/person-dossier.types';

interface CachedDossier {
  etag: string | null;
  data: PersonDossierResponse;
}

interface CachedPdf {
  etag: string | null;
  blob: Blob;
  filename: string;
}

@Injectable({ providedIn: 'root' })
export class PersonDossierService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private readonly defaultLimits: PersonDossierLimits = { profiles: 5, notes: 5, activities: 5 };
  private readonly cache = new Map<string, CachedDossier>();
  private readonly pdfCache = new Map<string, CachedPdf>();

  fetchDossier(
    personId: string,
    limits: Partial<PersonDossierLimits> = {},
    options: { force?: boolean } = {}
  ): Observable<PersonDossierSnapshot> {
    const normalizedId = this.normalizePersonId(personId);
    if (!normalizedId) {
      throw new Error('Person ID is required for dossier view.');
    }

    const resolvedLimits = this.resolveLimits(limits);
    const cacheKey = this.buildCacheKey(normalizedId, resolvedLimits);
    const cached = this.cache.get(cacheKey);

    const headers = this.buildHeaders(cached?.etag, options.force);
    const params = this.buildParams(resolvedLimits);
    const url = this.buildUrl(`/persons/${encodeURIComponent(normalizedId)}/dossier`);

    return this.http
      .get<PersonDossierResponse>(url, { headers, params, observe: 'response' })
      .pipe(map((response) => this.handleDossierResponse(response, cacheKey, cached)));
  }

  downloadPdf(
    personId: string,
    limits: Partial<PersonDossierLimits> = {},
    options: { force?: boolean } = {}
  ): Observable<PersonDossierPdfSnapshot> {
    const normalizedId = this.normalizePersonId(personId);
    if (!normalizedId) {
      throw new Error('Person ID is required for dossier export.');
    }

    const resolvedLimits = this.resolveLimits(limits);
    const cacheKey = `${this.buildCacheKey(normalizedId, resolvedLimits)}::pdf`;
    const cached = this.pdfCache.get(cacheKey);
    const headers = this.buildHeaders(cached?.etag, options.force);
    const params = this.buildParams(resolvedLimits);
    const url = this.buildUrl(`/persons/${encodeURIComponent(normalizedId)}/dossier.pdf`);

    return this.http
      .get(url, { headers, params, observe: 'response', responseType: 'blob' })
      .pipe(map((response) => this.handlePdfResponse(response, cacheKey, cached, normalizedId)));
  }

  clearCache(personId?: string): void {
    if (!personId) {
      this.cache.clear();
      this.pdfCache.clear();
      return;
    }
    const normalizedId = this.normalizePersonId(personId);
    if (!normalizedId) {
      return;
    }
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(normalizedId + '::')) {
        this.cache.delete(key);
      }
    }
    for (const key of Array.from(this.pdfCache.keys())) {
      if (key.startsWith(normalizedId + '::')) {
        this.pdfCache.delete(key);
      }
    }
  }

  private handleDossierResponse(
    response: HttpResponse<PersonDossierResponse>,
    cacheKey: string,
    cached: CachedDossier | undefined
  ): PersonDossierSnapshot {
    if (response.status === 304 && cached) {
      return { data: cached.data, etag: cached.etag ?? null, fromCache: true };
    }

    const body = response.body ?? cached?.data;
    if (!body) {
      throw new Error('Dossier payload is empty.');
    }

    const etag = response.headers.get('ETag');
    this.cache.set(cacheKey, { data: body, etag: etag ?? null });
    return { data: body, etag: etag ?? null, fromCache: false };
  }

  private handlePdfResponse(
    response: HttpResponse<Blob>,
    cacheKey: string,
    cached: CachedPdf | undefined,
    personId: string
  ): PersonDossierPdfSnapshot {
    if (response.status === 304 && cached) {
      return {
        blob: cached.blob,
        filename: cached.filename,
        etag: cached.etag ?? null,
        fromCache: true
      };
    }

    const blob = response.body ?? cached?.blob;
    if (!blob) {
      throw new Error('PDF payload is empty.');
    }

    const etag = response.headers.get('ETag') ?? null;
    const filename =
      this.extractFilename(response.headers.get('Content-Disposition')) ??
      `person_${personId}_dossier.pdf`;

    this.pdfCache.set(cacheKey, { blob, filename, etag });
    return { blob, filename, etag, fromCache: false };
  }

  private buildHeaders(etag: string | null | undefined, force = false): HttpHeaders | undefined {
    if (!etag || force) {
      return undefined;
    }
    return new HttpHeaders({ 'If-None-Match': etag });
  }

  private buildParams(limits: PersonDossierLimits): HttpParams {
    let params = new HttpParams();
    params = params.set('profiles_limit', limits.profiles.toString());
    params = params.set('notes_limit', limits.notes.toString());
    params = params.set('activities_limit', limits.activities.toString());
    return params;
  }

  private buildUrl(endpoint: string): string {
    const normalizedBase = this.baseUrl.replace(/\/+$/, '');
    const suffix = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${normalizedBase}${suffix}`;
  }

  private buildCacheKey(personId: string, limits: PersonDossierLimits): string {
    return `${personId}::${limits.profiles}:${limits.notes}:${limits.activities}`;
  }

  private resolveLimits(partial: Partial<PersonDossierLimits>): PersonDossierLimits {
    return {
      profiles: this.clampLimit(partial.profiles, this.defaultLimits.profiles),
      notes: this.clampLimit(partial.notes, this.defaultLimits.notes),
      activities: this.clampLimit(partial.activities, this.defaultLimits.activities)
    };
  }

  private clampLimit(value: number | null | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.max(0, Math.min(50, Math.trunc(value)));
  }

  private normalizePersonId(personId: string | number | null | undefined): string | null {
    if (typeof personId === 'number' && Number.isFinite(personId)) {
      return personId.toString();
    }
    if (typeof personId === 'string') {
      const trimmed = personId.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  }

  private extractFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) {
      return null;
    }
    const match = /filename=["']?([^"';]+)["']?/.exec(contentDisposition);
    return match?.[1] ?? null;
  }
}
