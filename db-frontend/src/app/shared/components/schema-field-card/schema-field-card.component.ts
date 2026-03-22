import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { Component, ElementRef, HostListener, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { SchemaField } from '../../../core/models/metadata.models';
import { getFieldOptions, supportsMultiple } from '../../../core/utils/schema.utils';

@Component({
  selector: 'app-schema-field-card',
  standalone: true,
  imports: [NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault, ReactiveFormsModule, RouterLink, TranslateModule],
  templateUrl: './schema-field-card.component.html',
  styleUrl: './schema-field-card.component.scss',
  host: {
    class: 'schema-field-card-host',
    '[class.schema-field-card-host--full]': 'isWideField()',
    '[class.schema-field-card-host--boolean]': 'isBooleanField()'
  }
})
export class SchemaFieldCardComponent {
  readonly field = input.required<SchemaField>();
  readonly control = input.required<FormControl<unknown>>();
  readonly fieldId = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly canEditSchema = input(false);
  readonly showRequiredMarker = input(false);
  readonly referenceLink = input<string[] | null>(null);
  readonly referenceLabel = input<string | null>(null);

  readonly editRequested = output<SchemaField>();

  multiSelectOpen = false;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  isWideField(): boolean {
    const dataType = this.field().data_type;
    return dataType === 'long_text' || dataType === 'json';
  }

  isBooleanField(): boolean {
    return this.field().data_type === 'boolean';
  }

  fieldOptions() {
    return getFieldOptions(this.field());
  }

  selectedMultiOptions() {
    const selectedValues = new Set(this.multiSelectValue());
    return this.fieldOptions().filter((option) => selectedValues.has(String(option.value)));
  }

  multiSelectSummary(): string {
    const selected = this.selectedMultiOptions();
    if (selected.length === 0) {
      return 'No tags selected';
    }
    if (selected.length <= 2) {
      return selected.map((option) => option.label).join(', ');
    }
    return `${selected.length} tags selected`;
  }

  onEditRequest(): void {
    this.editRequested.emit(this.field());
  }

  isMultipleReferenceLike(): boolean {
    const field = this.field();
    return (field.data_type === 'reference' || field.data_type === 'file') && supportsMultiple(field);
  }

  multiSelectValue(): string[] {
    const value = this.control().value;
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return [];
  }

  isMultiSelectOptionSelected(optionValue: string): boolean {
    return this.multiSelectValue().includes(String(optionValue));
  }

  toggleMultiSelectOption(optionValue: string): void {
    const current = this.multiSelectValue();
    const normalized = String(optionValue);
    const next = current.includes(normalized)
      ? current.filter((item) => item !== normalized)
      : [...current, normalized];

    this.control().setValue(next);
    this.control().markAsDirty();
    this.control().markAsTouched();
  }

  toggleMultiSelectPanel(): void {
    this.multiSelectOpen = !this.multiSelectOpen;
  }

  closeMultiSelectPanel(): void {
    this.multiSelectOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.multiSelectOpen) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (!this.elementRef.nativeElement.contains(target)) {
      this.closeMultiSelectPanel();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMultiSelectPanel();
  }
}
