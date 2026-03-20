import { inject, Injectable, signal } from '@angular/core';
import { map, Observable, tap } from 'rxjs';

import { ApiService } from './api.service';
import { EntrySchema } from '../models/metadata.models';
import { sortSchemaFields } from '../utils/schema.utils';

@Injectable({ providedIn: 'root' })
export class SchemaService {
  private readonly api = inject(ApiService);
  readonly schemas = signal<EntrySchema[]>([]);

  loadSchemas(force = false): Observable<EntrySchema[]> {
    if (!force && this.schemas().length > 0) {
      return new Observable<EntrySchema[]>((subscriber) => {
        subscriber.next(this.schemas());
        subscriber.complete();
      });
    }

    return this.api.request<EntrySchema[]>('GET', '/schemas').pipe(
      map((schemas) => schemas.map((schema) => this.normalizeSchema(schema))),
      tap((schemas) => this.schemas.set(schemas))
    );
  }

  getSchema(schemaId: string | number): Observable<EntrySchema> {
    return this.api
      .request<EntrySchema>('GET', `/schemas/${encodeURIComponent(String(schemaId))}`)
      .pipe(map((schema) => this.normalizeSchema(schema)));
  }

  getSchemaByKey(key: string): EntrySchema | null {
    const normalized = key.trim().toLowerCase();
    return this.schemas().find((schema) => schema.key.trim().toLowerCase() === normalized) ?? null;
  }

  private normalizeSchema(schema: EntrySchema): EntrySchema {
    return {
      ...schema,
      fields: sortSchemaFields((schema.fields ?? []).filter((field) => field.is_active !== false))
    };
  }
}
