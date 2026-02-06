export type EntryFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'json' | 'visibility';

export type DateFieldVariant = 'date' | 'datetime';

export interface EntrySchemaField {
  key: string;
  label: string;
  type: EntryFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: string | number | boolean;
  dateVariant?: DateFieldVariant;
}

export interface EntrySchemaRequirement {
  keys: string[];
  messageKey?: string;
}

export interface EntrySchema {
  type: string;
  title: string;
  description?: string;
  fields: EntrySchemaField[];
  requireOneOf?: EntrySchemaRequirement;
}

const VISIBILITY_FIELD_LABEL = 'Visibility';

function visibilityField(): EntrySchemaField {
  return {
    key: 'visibility_level',
    label: VISIBILITY_FIELD_LABEL,
    type: 'visibility',
    defaultValue: 'user'
  };
}

/**
 * Extend or adjust these schemas to match the API payloads you need to POST.
 * Keys should align with the backend field names.
 */
export const ENTRY_SCHEMAS: Record<string, EntrySchema> = {
  persons: {
    type: 'persons',
    title: 'Person',
    description: 'Create an individual with contact data, lifecycle status and optional metadata.',
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true },
      { key: 'last_name', label: 'Last name', type: 'text', required: true },
      { key: 'date_of_birth', label: 'Date of birth', type: 'date', dateVariant: 'date' },
      { key: 'gender', label: 'Gender', type: 'text', defaultValue: 'Unspecified' },
      { key: 'email', label: 'Email', type: 'text', defaultValue: 'not_provided@example.com' },
      { key: 'phone_number', label: 'Phone number', type: 'text', defaultValue: 'N/A' },
      { key: 'address_line1', label: 'Address line 1', type: 'text' },
      { key: 'address_line2', label: 'Address line 2', type: 'text' },
      { key: 'postal_code', label: 'Postal code', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'region_state', label: 'Region/State', type: 'text' },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'status', label: 'Status', type: 'text', defaultValue: 'active' },
      { key: 'nationality', label: 'Nationality', type: 'text' },
      { key: 'occupation', label: 'Occupation', type: 'text' },
      { key: 'risk_level', label: 'Risk level', type: 'text', defaultValue: 'N/A' },
      {
        key: 'tags',
        label: 'Tags (JSON array)',
        type: 'json',
        placeholder: '["vip","watchlist"]'
      },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      {
        key: 'metadata',
        label: 'Metadata (JSON)',
        type: 'json',
        placeholder: '{ "custom": "value" }',
        description: 'Attach any structured data as JSON.'
      },
      visibilityField()
    ]
  },
  profiles: {
    type: 'profiles',
    title: 'Profile',
    description: 'Link to a platform account with usernames, status and metadata.',
    fields: [
      { key: 'platform_id', label: 'Platform ID', type: 'number', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'external_id', label: 'External ID', type: 'text' },
      { key: 'display_name', label: 'Display name', type: 'text' },
      { key: 'url', label: 'Profile URL', type: 'text' },
      { key: 'status', label: 'Status', type: 'text', defaultValue: 'active' },
      { key: 'language', label: 'Language', type: 'text' },
      { key: 'region', label: 'Region', type: 'text' },
      { key: 'is_verified', label: 'Is verified', type: 'boolean' , defaultValue: false},
      { key: 'last_seen_at', label: 'Last seen at', type: 'date', dateVariant: 'datetime' },
      { key: 'avatar_url', label: 'Avatar URL', type: 'text' },
      { key: 'bio', label: 'Bio', type: 'textarea' },
      {
        key: 'metadata',
        label: 'Metadata (JSON)',
        type: 'json',
        placeholder: '{ "extra": true }'
      },
      visibilityField()
    ]
  },
  platforms: {
    type: 'platforms',
    title: 'Platform',
    description: 'Directory entry for social/media platforms used by profiles.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text', defaultValue: 'social' },
      { key: 'base_url', label: 'Base URL', type: 'text' },
      { key: 'api_base_url', label: 'API base URL', type: 'text' },
      { key: 'is_active', label: 'Is active', type: 'boolean', defaultValue: true },
      visibilityField()
    ]
  },
  activities: {
    type: 'activities',
    title: 'Activity',
    description: 'Timeline entry describing actions tied to persons, profiles or vehicles.',
    requireOneOf: {
      keys: ['vehicle_id', 'profile_id', 'community_id', 'item']
    },
    fields: [
      { key: 'person_id', label: 'Person ID', type: 'number', required: true, defaultValue: 1 },
      { key: 'activity_type', label: 'Activity type', type: 'text', required: true, defaultValue: 'Standard' },
      { key: 'occurred_at', label: 'Occurred at', type: 'date', dateVariant: 'datetime' },
      { key: 'vehicle_id', label: 'Vehicle ID', type: 'number' },
      { key: 'profile_id', label: 'Profile ID', type: 'number' },
      { key: 'community_id', label: 'Community ID', type: 'number' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
      {
        key: 'details',
        label: 'Details (JSON)',
        type: 'json',
        placeholder: '{ "context": "..." }'
      },
      { key: 'severity', label: 'Severity', type: 'text' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'ip_address', label: 'IP address', type: 'text' },
      { key: 'user_agent', label: 'User agent', type: 'text' },
      { key: 'geo_location', label: 'Geo location', type: 'text' },
      { key: 'created_by', label: 'Created by', type: 'text' },
      visibilityField()
    ]
  },
  vehicles: {
    type: 'vehicles',
    title: 'Vehicle',
    description: 'Register vehicles linked to persons or activities.',
    fields: [
      { key: 'label', label: 'Label', type: 'text', required: true },
      { key: 'make', label: 'Make', type: 'text' },
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'build_year', label: 'Build year', type: 'number' },
      { key: 'license_plate', label: 'License plate', type: 'text' },
      { key: 'vin', label: 'VIN', type: 'text' },
      { key: 'vehicle_type', label: 'Vehicle type', type: 'text' },
      { key: 'energy_type', label: 'Energy type', type: 'text' },
      { key: 'color', label: 'Color', type: 'text' },
      { key: 'mileage_km', label: 'Mileage (km)', type: 'number' },
      { key: 'last_service_at', label: 'Last service at', type: 'date', dateVariant: 'datetime' },
      {
        key: 'metadata',
        label: 'Metadata (JSON)',
        type: 'json',
        placeholder: '{ "notes": "..." }'
      },
      visibilityField()
    ]
  },
  notes: {
    type: 'notes',
    title: 'Note',
    description: 'Pinned or free-form note entries.',
    fields: [
      { key: 'person_id', label: 'Person ID', type: 'number', required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'text', label: 'Text', type: 'textarea', required: true },
      { key: 'pinned', label: 'Pinned', type: 'boolean', defaultValue: false },
      visibilityField()
    ]
  }
};

export function getEntrySchema(type: string): EntrySchema | null {
  if (!type) {
    return null;
  }

  const normalized = type.trim().toLowerCase();
  return ENTRY_SCHEMAS[normalized] ?? null;
}
