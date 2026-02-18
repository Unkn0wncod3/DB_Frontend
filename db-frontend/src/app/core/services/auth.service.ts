import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { API_BASE_URL } from '../tokens/api-base-url.token';

const AUTH_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export type AuthRole = 'head_admin' | 'admin' | 'editor' | 'user';

export interface AuthenticatedUser {
  id: string | number;
  username: string;
  role: AuthRole;
  is_active: boolean;
  created_at?: string;
  profile_picture_url?: string | null;
  preferences?: Record<string, unknown> | null;
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

const ROLE_PRIORITY: Record<AuthRole, number> = {
  user: 0,
  editor: 1,
  admin: 2,
  head_admin: 3
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiBaseUrl = inject(API_BASE_URL);
  private readonly storageKey = 'dbFrontendAuth';
  private readonly sessionDurationMs = AUTH_TOKEN_TTL_MS;
  private redirectUrl: string | null = null;

  private tokenValue: string | null;
  private userValue: AuthenticatedUser | null;
  private expiresAtValue: number | null;
  private readonly userSubject = new BehaviorSubject<AuthenticatedUser | null>(null);

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

    this.userSubject.next(this.userValue);
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

  userChanges(): Observable<AuthenticatedUser | null> {
    return this.userSubject.asObservable();
  }

  hasRole(role: AuthRole): boolean {
    const user = this.user();
    return !!user && user.role === role;
  }

  hasAnyRole(...roles: AuthRole[]): boolean {
    if (!roles || roles.length === 0) {
      return false;
    }
    const user = this.user();
    if (!user) {
      return false;
    }
    return roles.includes(user.role);
  }

  isAtLeast(role: AuthRole): boolean {
    const userRole = this.user()?.role;
    if (!userRole) {
      return false;
    }
    return ROLE_PRIORITY[userRole] >= ROLE_PRIORITY[role];
  }

  canWrite(): boolean {
    return this.canEditEntries();
  }

  canEditEntries(): boolean {
    return this.hasAnyRole('editor', 'admin', 'head_admin');
  }

  canCreateEntries(): boolean {
    return this.canEditEntries();
  }

  canDeleteEntries(): boolean {
    return this.hasAnyRole('admin', 'head_admin');
  }

  canManageUsers(): boolean {
    return this.hasAnyRole('admin', 'head_admin');
  }

  canAssignRole(targetRole: AuthRole): boolean {
    const currentRole = this.user()?.role;
    if (!currentRole) {
      return false;
    }

    if (currentRole === 'head_admin') {
      return true;
    }

    if (currentRole === 'admin') {
      return targetRole === 'editor' || targetRole === 'user';
    }

    return false;
  }

  canViewAdminVisibility(): boolean {
    return this.hasAnyRole('admin', 'head_admin');
  }

  canManageVisibility(): boolean {
    return this.canViewAdminVisibility();
  }

  isAdmin(): boolean {
    return this.hasAnyRole('admin', 'head_admin');
  }

  isHeadAdmin(): boolean {
    return this.hasRole('head_admin');
  }

  setRedirectUrl(url: string | null): void {
    this.redirectUrl = url;
  }

  consumeRedirectUrl(): string | null {
    const url = this.redirectUrl;
    this.redirectUrl = null;
    return url;
  }

  updateUser(user: AuthenticatedUser): void {
    if (!this.tokenValue || !this.expiresAtValue) {
      return;
    }
    this.persistState({ token: this.tokenValue, user, expiresAt: this.expiresAtValue });
  }

  handleUnauthorized(): void {
    const currentUrl = this.router.url;
    if (currentUrl && !currentUrl.startsWith('/login')) {
      this.setRedirectUrl(currentUrl);
    }
    this.logout();
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
    this.userSubject.next(this.userValue);

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


