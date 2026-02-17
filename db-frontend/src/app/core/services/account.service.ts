import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../tokens/api-base-url.token';
import { AuthenticatedUser } from './auth.service';

export interface UpdateAccountPayload {
  username?: string;
  password?: string;
  profile_picture_url?: string | null;
  preferences?: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = inject(API_BASE_URL);

  getProfile(): Observable<AuthenticatedUser> {
    return this.http.get<AuthenticatedUser>(this.buildUrl('/auth/me'));
  }

  updateProfile(payload: UpdateAccountPayload): Observable<AuthenticatedUser> {
    return this.http.patch<AuthenticatedUser>(this.buildUrl('/auth/me'), payload);
  }

  private buildUrl(endpoint: string): string {
    const normalizedBase = this.apiBaseUrl.replace(/\/+$/, '');
    const suffix = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${normalizedBase}${suffix}`;
  }
}
