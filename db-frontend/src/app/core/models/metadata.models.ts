export type UserRole = 'head_admin' | 'admin' | 'manager' | 'editor' | 'reader';

export type VisibilityLevel = 'public' | 'internal' | 'private' | 'restricted';

export type FieldDataType =
  | 'text'
  | 'long_text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'email'
  | 'url'
  | 'select'
  | 'multi_select'
  | 'reference'
  | 'file'
  | 'json';

export type EntryPermission =
  | 'read'
  | 'view_history'
  | 'edit'
  | 'edit_status'
  | 'edit_visibility'
  | 'manage_relations'
  | 'manage_attachments'
  | 'manage_permissions'
  | 'delete'
  | 'manage';

export interface AuthenticatedUser {
  id: string | number;
  username: string;
  role: UserRole;
  is_active: boolean;
  profile_picture_url?: string | null;
  preferences?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface SchemaField {
  id: string | number;
  schema_id: string | number;
  key: string;
  label: string;
  description?: string | null;
  data_type: FieldDataType;
  is_required: boolean;
  is_unique: boolean;
  default_value?: unknown;
  sort_order: number;
  is_active: boolean;
  validation_json?: Record<string, unknown> | null;
  settings_json?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface EntrySchema {
  id: string | number;
  key: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  fields: SchemaField[];
}

export interface EntryRecord {
  id: string | number;
  schema_id: string | number;
  title: string;
  status?: string | null;
  visibility_level: VisibilityLevel;
  owner_id?: string | number | null;
  created_by?: string | number | null;
  data_json: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
  deleted_at?: string | null;
}

export interface EntryRecordWithAccess extends EntryRecord {
  access?: EntryAccessMap | null;
}

export interface EntryHistoryRecord {
  id: string | number;
  entry_id: string | number;
  changed_by?: string | number | null;
  change_type: string;
  old_data_json?: Record<string, unknown> | null;
  new_data_json?: Record<string, unknown> | null;
  old_visibility_level?: VisibilityLevel | null;
  new_visibility_level?: VisibilityLevel | null;
  changed_at: string;
  comment?: string | null;
}

export interface EntryRelationRecord {
  id: string | number;
  from_entry_id: string | number;
  to_entry_id: string | number;
  relation_type: string;
  sort_order?: number | null;
  metadata_json?: Record<string, unknown> | null;
  created_at?: string;
}

export interface AttachmentRecord {
  id: string | number;
  entry_id: string | number;
  file_name: string;
  stored_path?: string | null;
  external_url?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  checksum?: string | null;
  uploaded_by?: string | number | null;
  uploaded_at?: string;
  description?: string | null;
}

export interface EntryPermissionRecord {
  id: string | number;
  entry_id: string | number;
  subject_type: 'user' | 'role' | 'group';
  subject_id: string;
  permission: EntryPermission;
  created_at?: string;
  created_by?: string | number | null;
}

export interface EntryAccessMap {
  read: boolean;
  view_history: boolean;
  edit: boolean;
  edit_status: boolean;
  edit_visibility: boolean;
  manage_relations: boolean;
  manage_attachments: boolean;
  manage_permissions: boolean;
  delete: boolean;
  manage: boolean;
}

export interface EntryBundle {
  entry: EntryRecord;
  schema: EntrySchema;
  access: EntryAccessMap;
  history: EntryHistoryRecord[];
  relations: EntryRelationRecord[];
  attachments: AttachmentRecord[];
  permissions: EntryPermissionRecord[];
}

export interface EntryListParams {
  schema_id?: string | number;
  owner_id?: string | number;
}

export interface SchemaEntriesResponse {
  schema: EntrySchema;
  entries: EntryRecordWithAccess[];
}

export interface CreateSchemaPayload {
  key: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  is_active?: boolean;
}

export interface CreateFieldPayload {
  key: string;
  label: string;
  description?: string | null;
  data_type: FieldDataType;
  is_required?: boolean;
  is_unique?: boolean;
  default_value?: unknown;
  sort_order?: number;
  is_active?: boolean;
  validation_json?: Record<string, unknown>;
  settings_json?: Record<string, unknown>;
}

export interface UpdateFieldPayload {
  key?: string;
  label?: string;
  description?: string | null;
  data_type?: FieldDataType;
  is_required?: boolean;
  is_unique?: boolean;
  default_value?: unknown;
  sort_order?: number;
  is_active?: boolean;
  validation_json?: Record<string, unknown>;
  settings_json?: Record<string, unknown>;
}

export interface CreateEntryPayload {
  schema_id: string | number;
  title: string;
  status?: string | null;
  visibility_level?: VisibilityLevel;
  owner_id?: string | number | null;
  data_json: Record<string, unknown>;
}

export interface UpdateEntryPayload {
  title?: string;
  status?: string | null;
  visibility_level?: VisibilityLevel;
  owner_id?: string | number | null;
  data_json?: Record<string, unknown>;
  archived_at?: string | null;
  deleted_at?: string | null;
  comment?: string | null;
}
