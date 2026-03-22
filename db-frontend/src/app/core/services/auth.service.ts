import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { API_BASE_URL } from '../tokens/api-base-url.token';
import { AuthenticatedUser, UserRole } from '../models/metadata.models';

export type AuthRole = UserRole;
export type { AuthenticatedUser } from '../models/metadata.models';

const AUTH_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthLoginResponse {
  access_token: string;
  token_type?: string;
  user: AuthenticatedUser;
}

interface StoredAuthState {
  token: string;
  user?: AuthenticatedUser | null;
  expiresAt: number;
}

const ROLE_PRIORITY: Record<UserRole, number> = {
  reader: 0,
  editor: 1,
  manager: 2,
  admin: 3,
  head_admin: 4
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

    if (this.tokenValue) {
      this.refreshCurrentUser().subscribe();
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

  refreshCurrentUser(): Observable<AuthenticatedUser | null> {
    if (!this.token()) {
      return of(null);
    }

    return this.http.get<AuthenticatedUser>(this.normalizeUrl('/auth/me')).pipe(
      tap((user) => this.updateUser(user)),
      catchError(() => of(this.user()))
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

  hasRole(role: UserRole): boolean {
    return this.user()?.role === role;
  }

  hasAnyRole(...roles: UserRole[]): boolean {
    const currentRole = this.user()?.role;
    return !!currentRole && roles.includes(currentRole);
  }

  isAtLeast(role: UserRole): boolean {
    const userRole = this.user()?.role;
    return !!userRole && ROLE_PRIORITY[userRole] >= ROLE_PRIORITY[role];
  }

  canCreateEntries(): boolean {
    return this.isAtLeast('editor');
  }

  canEditEntries(): boolean {
    return this.isAtLeast('editor');
  }

  canManageSchemas(): boolean {
    return this.isAtLeast('manager');
  }

  canDeleteEntries(): boolean {
    return this.isAtLeast('editor');
  }

  canManageUsers(): boolean {
    return this.isAtLeast('admin');
  }

  canAccessApiExplorer(): boolean {
    if (!this.isAdmin()) {
      return false;
    }

    const preferences = this.user()?.preferences;
    if (!preferences || typeof preferences !== 'object') {
      return true;
    }

    const adminPreferences = preferences['admin_preferences'];
    if (!adminPreferences || typeof adminPreferences !== 'object') {
      return false;
    }

    const value = (adminPreferences as Record<string, unknown>)['show_api_explorer'];
    return typeof value === 'boolean' ? value : false;
  }

  canViewAdminVisibility(): boolean {
    return this.isAdmin();
  }

  canManageVisibility(): boolean {
    return this.isAtLeast('manager');
  }

  canAssignRole(targetRole: UserRole): boolean {
    if (this.hasRole('head_admin')) {
      return true;
    }
    if (this.hasRole('admin')) {
      return targetRole === 'manager' || targetRole === 'editor' || targetRole === 'reader';
    }
    return false;
  }

  isAdmin(): boolean {
    return this.isAtLeast('admin');
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
