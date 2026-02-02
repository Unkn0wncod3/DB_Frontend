export interface EntryFieldConfig {
  key: string;
  label: string;
  multiline: boolean;
  readOnly: boolean;
  inputType: EntryFieldInputType;
  dateVariant?: 'date' | 'datetime';
}

export interface RelatedEntryItem {
  id?: string;
  label: string;
  description?: string;
  timestamp?: string;
  routerLink?: string[];
  type: string;
}

export type EntryFieldInputType = 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
