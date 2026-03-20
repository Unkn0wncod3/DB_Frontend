import { inject, Injectable, signal } from '@angular/core';
import { map, Observable, of, tap } from 'rxjs';

import { ApiService } from './api.service';
import { CreateFieldPayload, CreateSchemaPayload, EntrySchema, SchemaEntriesResponse, SchemaField, UpdateFieldPayload } from '../models/metadata.models';
import { sortSchemaFields } from '../utils/schema.utils';

@Injectable({ providedIn: 'root' })
export class SchemaService {
  private readonly api = inject(ApiService);
  readonly schemas = signal<EntrySchema[]>([]);

  loadSchemas(force = false, includeInactive = false): Observable<EntrySchema[]> {
    if (!force && !includeInactive && this.schemas().length > 0) {
      return of(this.schemas());
    }

    return this.api.request<EntrySchema[]>('GET', '/schemas', { params: includeInactive ? { include_inactive: 'true' } : undefined }).pipe(
      map((schemas) => schemas.map((schema) => this.normalizeSchema(schema))),
      tap((schemas) => {
        if (!includeInactive) {
          this.schemas.set(schemas);
        }
      })
    );
  }

  getSchema(schemaId: string | number): Observable<EntrySchema> {
    return this.api
      .request<EntrySchema>('GET', `/schemas/${encodeURIComponent(String(schemaId))}`)
      .pipe(map((schema) => this.normalizeSchema(schema)));
  }

  getSchemaByKey(key: string): EntrySchema | null {
    return this.resolveSchemaByKey(key, this.schemas());
  }

  getSchemaEntries(schemaId: string | number): Observable<SchemaEntriesResponse> {
    return this.api
      .request<SchemaEntriesResponse>('GET', `/schemas/${encodeURIComponent(String(schemaId))}/entries`)
      .pipe(
        map((payload) => ({
          schema: this.normalizeSchema(payload.schema),
          entries: Array.isArray(payload.entries) ? payload.entries : []
        }))
      );
  }

  createSchema(payload: CreateSchemaPayload): Observable<EntrySchema> {
    return this.api.request<EntrySchema>('POST', '/schemas', { body: payload }).pipe(
      map((schema) => this.normalizeSchema(schema)),
      tap((schema) => this.schemas.set([...this.schemas(), schema]))
    );
  }

  createField(schemaId: string | number, payload: CreateFieldPayload): Observable<SchemaField> {
    return this.api.request<SchemaField>('POST', `/schemas/${encodeURIComponent(String(schemaId))}/fields`, { body: payload }).pipe(
      tap((field) => {
        const updated = this.schemas().map((schema) =>
          String(schema.id) === String(schemaId)
            ? this.normalizeSchema({ ...schema, fields: [...(schema.fields ?? []), field] })
            : schema
        );
        this.schemas.set(updated);
      })
    );
  }

  listFields(schemaId: string | number, includeInactive = true): Observable<SchemaField[]> {
    return this.api.request<SchemaField[]>('GET', `/schemas/${encodeURIComponent(String(schemaId))}/fields`, {
      params: { include_inactive: String(includeInactive) }
    });
  }

  getField(schemaId: string | number, fieldId: string | number): Observable<SchemaField> {
    return this.api.request<SchemaField>('GET', `/schemas/${encodeURIComponent(String(schemaId))}/fields/${encodeURIComponent(String(fieldId))}`);
  }

  updateField(schemaId: string | number, fieldId: string | number, payload: UpdateFieldPayload): Observable<SchemaField> {
    return this.api.request<SchemaField>('PATCH', `/schemas/${encodeURIComponent(String(schemaId))}/fields/${encodeURIComponent(String(fieldId))}`, {
      body: payload
    }).pipe(
      tap((field) => {
        const updated = this.schemas().map((schema) =>
          String(schema.id) === String(schemaId)
            ? this.normalizeSchema({
                ...schema,
                fields: (schema.fields ?? []).map((item) => (String(item.id) === String(fieldId) ? field : item))
              })
            : schema
        );
        this.schemas.set(updated);
      })
    );
  }

  deleteField(schemaId: string | number, fieldId: string | number): Observable<SchemaField> {
    return this.api.request<SchemaField>('DELETE', `/schemas/${encodeURIComponent(String(schemaId))}/fields/${encodeURIComponent(String(fieldId))}`).pipe(
      tap((_field) => {
        const updated = this.schemas().map((schema) =>
          String(schema.id) === String(schemaId)
            ? this.normalizeSchema({
                ...schema,
                fields: (schema.fields ?? []).filter((item) => String(item.id) !== String(fieldId))
              })
            : schema
        );
        this.schemas.set(updated);
      })
    );
  }

  resolveSchemaByKey(key: string, schemas: EntrySchema[] = this.schemas()): EntrySchema | null {
    const normalized = this.normalizeSchemaKey(key);
    if (!normalized) {
      return null;
    }

    return schemas.find((schema) => this.normalizeSchemaKey(schema.key) === normalized) ?? null;
  }

  private normalizeSchema(schema: EntrySchema): EntrySchema {
    return {
      ...schema,
      fields: sortSchemaFields((schema.fields ?? []).filter((field) => field.is_active !== false))
    };
  }

  private normalizeSchemaKey(value: string | null | undefined): string {
    const normalized = (value ?? '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }

    const aliases: Record<string, string> = {
      persons: 'person',
      organizations: 'organization',
      todos: 'todo',
      vehicles: 'vehicle',
      casefiles: 'case_file',
      case_files: 'case_file',
      cases: 'case_file'
    };

    if (aliases[normalized]) {
      return aliases[normalized];
    }

    if (normalized.endsWith('ies')) {
      return `${normalized.slice(0, -3)}y`;
    }

    if (normalized.endsWith('s')) {
      return normalized.slice(0, -1);
    }

    return normalized;
  }
}
