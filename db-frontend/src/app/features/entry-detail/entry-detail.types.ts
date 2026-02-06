import { ValueDropdownOption } from '../../shared/components/value-dropdown/value-dropdown.component';

export interface EntryFieldConfig {
  key: string;
  label: string;
  multiline: boolean;
  readOnly: boolean;
  inputType: EntryFieldInputType;
  dateVariant?: 'date' | 'datetime';
  options?: ValueDropdownOption[];
}

export interface RelatedEntryItem {
  id?: string;
  label: string;
  description?: string;
  timestamp?: string;
  routerLink?: string[];
  type: string;
  note?: string;
}

export type EntryFieldInputType = 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' | 'json' | 'select';
