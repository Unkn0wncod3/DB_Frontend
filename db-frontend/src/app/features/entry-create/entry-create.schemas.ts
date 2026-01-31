export type EntryFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'json';

export interface EntrySchemaField {
  key: string;
  label: string;
  type: EntryFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: string | number | boolean;
}

export interface EntrySchema {
  type: string;
  title: string;
  description?: string;
  fields: EntrySchemaField[];
}

/**
 * Extend or adjust these schemas to match the API payloads you need to POST.
 * Keys should align with the backend field names.
 */
export const ENTRY_SCHEMAS: Record<string, EntrySchema> = {
  persons: {
    type: 'persons',
    title: 'Person',
    description: 'Basic profile data for a person entity.',
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true },
      { key: 'last_name', label: 'Last name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'text', placeholder: 'user@example.com' },
      { key: 'status', label: 'Status', type: 'text', defaultValue: 'active' },
      {
        key: 'metadata',
        label: 'Metadata (JSON)',
        type: 'json',
        placeholder: '{ "notes": "Optional" }',
        description: 'Attach any structured data as JSON.'
      }
    ]
  },
  profiles: {
    type: 'profiles',
    title: 'Profile',
    description: 'Account profile attributes.',
    fields: [
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'display_name', label: 'Display name', type: 'text' },
      { key: 'bio', label: 'Bio', type: 'textarea', placeholder: 'Short bio or description.' },
      { key: 'avatar_url', label: 'Avatar URL', type: 'text' }
    ]
  },
  activities: {
    type: 'activities',
    title: 'Activity',
    description: 'Timeline activity entry.',
    fields: [
      { key: 'type', label: 'Activity type', type: 'text', required: true },
      {
        key: 'occurred_at',
        label: 'Occurred at',
        type: 'date',
        description: 'Defaults to now if left blank.'
      },
      { key: 'actor_id', label: 'Actor ID', type: 'text' },
      {
        key: 'payload',
        label: 'Payload (JSON)',
        type: 'json',
        placeholder: '{ "details": "..." }'
      }
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
