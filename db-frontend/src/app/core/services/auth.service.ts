import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { API_BASE_URL } from '../tokens/api-base-url.token';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthenticatedUser {
  username: string;
  role?: string;
}

export interface AuthLoginResponse {
  access_token: string;
  user: AuthenticatedUser;
}

interface StoredAuthState {
  token: string;
  user?: AuthenticatedUser | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly storageKey = 'dbFrontendAuth';
  private redirectUrl: string | null = null;

  private tokenValue: string | null;
  private userValue: AuthenticatedUser | null;

  constructor() {
    const stored = this.readStoredState();
    this.tokenValue = stored?.token ?? null;
    this.userValue = stored?.user ?? null;
  }

  login(payload: AuthLoginRequest): Observable<AuthLoginResponse> {
    const url = this.normalizeUrl('/auth/login');
    return this.http.post<AuthLoginResponse>(url, payload).pipe(
      tap((response) => {
        this.persistState({ token: response.access_token, user: response.user });
      })
    );
  }

  logout(): void {
    this.persistState(null);
    void this.router.navigate(['/login']);
  }

  isAuthenticated(): boolean {
    return Boolean(this.tokenValue);
  }

  token(): string | null {
    return this.tokenValue;
  }

  user(): AuthenticatedUser | null {
    return this.userValue;
  }

  setRedirectUrl(url: string | null): void {
    this.redirectUrl = url;
  }

  consumeRedirectUrl(): string | null {
    const url = this.redirectUrl;
    this.redirectUrl = null;
    return url;
  }

  private normalizeUrl(endpoint: string): string {
    const base = this.apiBaseUrl.replace(/\/+$/, '');
    const suffix = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${base}${suffix}`;
  }

  private persistState(state: StoredAuthState | null): void {
    this.tokenValue = state?.token ?? null;
    this.userValue = state?.user ?? null;

    if (state?.token) {
      this.writeStoredState(state);
    } else {
      this.clearStoredState();
    }
  }

  private readStoredState(): StoredAuthState | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const value = window.localStorage.getItem(this.storageKey);
      return value ? (JSON.parse(value) as StoredAuthState) : null;
    } catch {
      return null;
    }
  }

  private writeStoredState(state: StoredAuthState): void {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // ignore write failures
    }
  }

  private clearStoredState(): void {
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
  }
}
