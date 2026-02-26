import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from './api.service';
import { AuthRole } from './auth.service';

export interface UserAccount {
  id: string | number;
  username: string;
  role: AuthRole;
  is_active: boolean;
  created_at?: string;
  profile_picture_url?: string | null;
  preferences?: Record<string, unknown> | null;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role: AuthRole;
  profile_picture_url?: string | null;
  preferences?: Record<string, unknown> | null;
}
export interface UpdateUserPayload {
  username?: string;
  password?: string;
  role?: AuthRole;
  is_active?: boolean;
  profile_picture_url?: string | null;
  preferences?: Record<string, unknown> | null;
}

export interface UpdateUserStatusPayload {
  is_active: boolean;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly api = inject(ApiService);

  listUsers(limit = 50, offset = 0): Observable<UserAccount[]> {
    return this.api.request<unknown>('GET', '/users', { params: { limit, offset } }).pipe(map(this.normalizeList));
  }

  createUser(payload: CreateUserPayload): Observable<UserAccount> {
    return this.api.request<UserAccount>('POST', '/users', { body: payload }).pipe(map(this.normalizeUser));
  }

  updateUser(id: string | number, payload: UpdateUserPayload): Observable<UserAccount> {
    const normalized = String(id).trim();
    return this.api
      .request<UserAccount>('PATCH', `/users/${encodeURIComponent(normalized)}`, { body: payload })
      .pipe(map(this.normalizeUser));
  }

  deleteUser(id: string | number): Observable<void> {
    const normalized = String(id).trim();
    return this.api.request<void>('DELETE', `/users/${encodeURIComponent(normalized)}`);
  }

  updateUserStatus(id: string | number, isActive: boolean): Observable<UserAccount> {
    const normalized = String(id).trim();
    const body: UpdateUserStatusPayload = { is_active: isActive };
    return this.api
      .request<UserAccount>('PATCH', `/users/${encodeURIComponent(normalized)}/status`, { body })
      .pipe(map(this.normalizeUser));
  }

  private normalizeList = (payload: unknown): UserAccount[] => {
    if (!payload) {
      return [];
    }

    if (Array.isArray(payload)) {
      return payload.map(this.normalizeUser);
    }

    if (typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const items = record['items'] ?? record['results'] ?? record['data'];
      if (Array.isArray(items)) {
        return items.map(this.normalizeUser);
      }
    }

    return [];
  };

  private normalizeUser = (candidate: unknown): UserAccount => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid user payload');
    }

    const record = candidate as Record<string, unknown>;
    const id = record['id'] ?? record['_id'];
    const username = typeof record['username'] === 'string' ? record['username'] : '';
    const role = (record['role'] as AuthRole) ?? 'user';
    const isActive = Boolean(record['is_active'] ?? true);

    if (!username) {
      throw new Error('Username missing');
    }

    return {
      id: typeof id === 'number' || typeof id === 'string' ? id : username,
      username,
      role,
      is_active: isActive,
      created_at: typeof record['created_at'] === 'string' ? record['created_at'] : undefined,
      profile_picture_url: typeof record['profile_picture_url'] === 'string' ? record['profile_picture_url'] : null,
      preferences: typeof record['preferences'] === 'object' && record['preferences'] !== null ? (record['preferences'] as Record<string, unknown>) : null
    };
  };
}
