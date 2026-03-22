import { FormBuilder, Validators } from '@angular/forms';

import { CreateFieldPayload, FieldDataType, SchemaField, UpdateFieldPayload } from '../models/metadata.models';
import { getFieldOptions } from './schema.utils';

export interface SchemaFieldDialogValue {
  label: string;
  key: string;
  description: string;
  data_type: FieldDataType;
  options: string;
  default_value: string;
  is_required: boolean;
}

export const DEFAULT_SCHEMA_FIELD_DIALOG_VALUE: SchemaFieldDialogValue = {
  label: '',
  key: '',
  description: '',
  data_type: 'text',
  options: '',
  default_value: '',
  is_required: false
};

export function createSchemaFieldDialogForm(fb: FormBuilder) {
  return fb.nonNullable.group({
    label: [DEFAULT_SCHEMA_FIELD_DIALOG_VALUE.label, [Validators.required]],
    key: [DEFAULT_SCHEMA_FIELD_DIALOG_VALUE.key],
    description: [DEFAULT_SCHEMA_FIELD_DIALOG_VALUE.description],
    data_type: [DEFAULT_SCHEMA_FIELD_DIALOG_VALUE.data_type, [Validators.required]],
    options: [DEFAULT_SCHEMA_FIELD_DIALOG_VALUE.options],
    default_value: [DEFAULT_SCHEMA_FIELD_DIALOG_VALUE.default_value],
    is_required: [DEFAULT_SCHEMA_FIELD_DIALOG_VALUE.is_required]
  });
}

export function resetSchemaFieldDialogForm(form: ReturnType<typeof createSchemaFieldDialogForm>): void {
  form.reset(DEFAULT_SCHEMA_FIELD_DIALOG_VALUE);
}

export function patchSchemaFieldDialogForm(form: ReturnType<typeof createSchemaFieldDialogForm>, field: SchemaField): void {
  form.reset({
    label: field.label ?? '',
    key: field.key ?? '',
    description: field.description ?? '',
    data_type: field.data_type,
    options: getFieldOptions(field)
      .map((option) => option.value)
      .join(', '),
    default_value: serializeDefaultValueForSchemaFieldDialog(field),
    is_required: field.is_required
  });
}

export function normalizeSchemaFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function shouldShowSchemaFieldOptionsInput(dataType: FieldDataType): boolean {
  return dataType === 'select' || dataType === 'multi_select';
}

export function buildSchemaFieldValidationJson(value: SchemaFieldDialogValue): Record<string, unknown> {
  const validationJson: Record<string, unknown> = {};

  if (shouldShowSchemaFieldOptionsInput(value.data_type)) {
    const options = value.options
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (options.length > 0) {
      validationJson['options'] = options;
    }
  }

  return validationJson;
}

export function buildSchemaFieldDefaultValue(value: SchemaFieldDialogValue, clearWhenEmpty: boolean): unknown {
  const normalized = value.default_value.trim();

  if (!normalized) {
    return clearWhenEmpty ? null : undefined;
  }

  switch (value.data_type) {
    case 'integer':
      return Number.parseInt(normalized, 10);
    case 'decimal':
      return Number.parseFloat(normalized);
    case 'boolean':
      return toBoolean(normalized);
    case 'json':
      return JSON.parse(normalized);
    case 'multi_select':
      return normalized
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    default:
      return normalized;
  }
}

export function buildCreateSchemaFieldPayload(
  value: SchemaFieldDialogValue,
  normalizedKey: string,
  sortOrder: number
): CreateFieldPayload {
  return {
    key: normalizedKey,
    label: value.label.trim(),
    description: value.description.trim() || null,
    data_type: value.data_type,
    is_required: value.is_required,
    is_unique: false,
    sort_order: sortOrder,
    is_active: true,
    default_value: buildSchemaFieldDefaultValue(value, false),
    validation_json: buildSchemaFieldValidationJson(value),
    settings_json: {}
  };
}

export function buildUpdateSchemaFieldPayload(value: SchemaFieldDialogValue, normalizedKey: string): UpdateFieldPayload {
  return {
    key: normalizedKey,
    label: value.label.trim(),
    description: value.description.trim() || null,
    data_type: value.data_type,
    is_required: value.is_required,
    default_value: buildSchemaFieldDefaultValue(value, true),
    validation_json: buildSchemaFieldValidationJson(value)
  };
}

function serializeDefaultValueForSchemaFieldDialog(field: SchemaField): string {
  const value = field.default_value;

  if (value == null) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
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
