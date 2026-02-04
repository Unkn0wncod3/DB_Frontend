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
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly storageKey = 'dbFrontendAuth';
  private readonly sessionDurationMs = 60 * 60 * 1000;
  private redirectUrl: string | null = null;

  private tokenValue: string | null;
  private userValue: AuthenticatedUser | null;
  private expiresAtValue: number | null;

  constructor() {
    const stored = this.readStoredState();

    if (stored && this.isStateValid(stored)) {
      this.tokenValue = stored.token;
      this.userValue = stored.user ?? null;
      this.expiresAtValue = stored.expiresAt;
    } else {
      this.tokenValue = null;
      this.userValue = null;
      this.expiresAtValue = null;
      if (stored) {
        this.clearStoredState();
      }
    }
  }

  login(payload: AuthLoginRequest): Observable<AuthLoginResponse> {
    const url = this.normalizeUrl('/auth/login');
    return this.http.post<AuthLoginResponse>(url, payload).pipe(
      tap((response) => {
        const expiresAt = Date.now() + this.sessionDurationMs;
        this.persistState({ token: response.access_token, user: response.user, expiresAt });
      })
    );
  }

  logout(): void {
    this.persistState(null);
    void this.router.navigate(['/login']);
  }

  isAuthenticated(): boolean {
    return this.ensureActiveSession();
  }

  token(): string | null {
    return this.ensureActiveSession() ? this.tokenValue : null;
  }

  user(): AuthenticatedUser | null {
    return this.ensureActiveSession() ? this.userValue : null;
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
    this.expiresAtValue = state?.expiresAt ?? null;

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

  private isStateValid(state: StoredAuthState): boolean {
    return typeof state.expiresAt === 'number' && state.expiresAt > Date.now();
  }

  private ensureActiveSession(): boolean {
    if (!this.tokenValue) {
      return false;
    }
    if (!this.expiresAtValue || Date.now() >= this.expiresAtValue) {
      this.logout();
      return false;
    }
    return true;
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


