import { NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { SchemaField } from '../../../core/models/metadata.models';
import { getFieldOptions, supportsMultiple } from '../../../core/utils/schema.utils';

@Component({
  selector: 'app-schema-field-card',
  standalone: true,
  imports: [NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault, ReactiveFormsModule, RouterLink, TranslateModule],
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

  onEditRequest(): void {
    this.editRequested.emit(this.field());
  }

  isMultipleReferenceLike(): boolean {
    const field = this.field();
    return (field.data_type === 'reference' || field.data_type === 'file') && supportsMultiple(field);
  }
}
