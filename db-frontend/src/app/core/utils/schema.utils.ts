import { EntryRecord, EntrySchema, FieldDataType, SchemaField } from '../models/metadata.models';

export interface SelectOption {
  label: string;
  value: string;
}

export function sortSchemaFields(fields: SchemaField[]): SchemaField[] {
  return [...fields].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

export function humanizeKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getFieldOptions(field: SchemaField): SelectOption[] {
  const settings = asRecord(field.settings_json);
  const validation = asRecord(field.validation_json);
  const optionSources = [
    settings?.['options'],
    validation?.['options'],
    settings?.['choices'],
    validation?.['choices']
  ];

  for (const source of optionSources) {
    const options = parseOptions(source);
    if (options.length > 0) {
      return options;
    }
  }

  return [];
}

export function supportsMultiple(field: SchemaField): boolean {
  const settings = asRecord(field.settings_json);
  return Boolean(settings?.['multiple']) || field.data_type === 'multi_select';
}

export function getReferenceSchemaKey(field: SchemaField): string | null {
  const settings = asRecord(field.settings_json);
  const validation = asRecord(field.validation_json);
  const candidate =
    settings?.['reference_schema_key'] ??
    settings?.['schema_key'] ??
    validation?.['reference_schema_key'];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

export function getFieldValue(entry: EntryRecord, field: SchemaField): unknown {
  return entry.data_json?.[field.key] ?? null;
}

export function resolveEntryTitle(entry: EntryRecord, schema?: EntrySchema | null): string {
  const directTitle = entry.title?.trim();
  if (directTitle) {
    return directTitle;
  }

  const preferredKeys = sortSchemaFields(schema?.fields ?? [])
    .map((field) => field.key)
    .filter((key) => ['title', 'name', 'summary', 'label', 'case_number', 'legal_name'].includes(key));

  for (const key of preferredKeys) {
    const value = entry.data_json?.[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return `Entry ${entry.id}`;
}

export function formatFieldValue(value: unknown, field?: SchemaField | null): string {
  if (value == null) {
    return '';
  }

  if (field?.data_type === 'boolean') {
    return toBoolean(value) ? 'True' : 'False';
  }

  if (field?.data_type === 'multi_select' && Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }

  if (field?.data_type === 'json') {
    return stringifyJson(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }

  if (typeof value === 'object') {
    return stringifyJson(value);
  }

  return String(value);
}

export function coerceFieldInputType(field: SchemaField): FieldDataType {
  return field.data_type;
}

function parseOptions(source: unknown): SelectOption[] {
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) {
      return [];
    }

    try {
      return parseOptions(JSON.parse(trimmed));
    } catch {
      return trimmed
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => ({ label: item, value: item }));
    }
  }

  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        return { label: String(item), value: String(item) };
      }

      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const value = record['value'] ?? record['id'] ?? record['key'];
        if (value == null) {
          return null;
        }
        const label = record['label'] ?? record['name'] ?? value;
        return { label: String(label), value: String(value) };
      }

      return null;
    })
    .filter((item): item is SelectOption => item !== null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}
