import { NgFor, NgIf, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { EntryFieldConfig } from '../../entry-detail.types';
import { ValueDropdownComponent, ValueDropdownOption } from '../../../../shared/components/value-dropdown/value-dropdown.component';

@Component({
  selector: 'app-entry-detail-field-grid',
  standalone: true,
  imports: [
    NgIf,
    NgFor,
    NgSwitch,
    NgSwitchCase,
    NgSwitchDefault,
    ReactiveFormsModule,
    TranslateModule,
    ValueDropdownComponent
  ],
  templateUrl: './entry-detail-field-grid.component.html',
  styleUrls: ['./entry-detail-field-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryDetailFieldGridComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input({ required: true }) fields: EntryFieldConfig[] = [];
  @Input({ required: true }) booleanOptions: ValueDropdownOption[] = [];

  readonly booleanPlaceholderKey = 'entryCreate.form.booleanPlaceholder';

  trackByKey(_index: number, field: EntryFieldConfig): string {
    return field.key;
  }
}
