import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface ValueDropdownOption {
  label: string;
  value: string | number | boolean | null;
}

@Component({
  selector: 'app-value-dropdown',
  standalone: true,
  imports: [NgIf, NgFor],
  templateUrl: './value-dropdown.component.html',
  styleUrl: './value-dropdown.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ValueDropdownComponent),
      multi: true
    }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ValueDropdownComponent implements ControlValueAccessor, OnChanges {
  @Input() options: ValueDropdownOption[] = [];
  @Input() placeholder = '';

  selectedIndex = '';
  isDisabled = false;

  private currentValue: ValueDropdownOption['value'] = null;
  private onChange: (value: ValueDropdownOption['value']) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnChanges(_changes: SimpleChanges): void {
    this.selectedIndex = this.findSelectedIndex(this.currentValue);
  }

  writeValue(value: ValueDropdownOption['value']): void {
    this.currentValue = value;
    this.selectedIndex = this.findSelectedIndex(value);
  }

  registerOnChange(fn: (value: ValueDropdownOption['value']) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
  }

  handleChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const value = target.value;

    if (value === '') {
      this.currentValue = null;
      this.selectedIndex = '';
      this.onChange(null);
      this.onTouched();
      return;
    }

    const index = Number(value);
    const option = Number.isNaN(index) ? undefined : this.options[index];
    const nextValue = option ? option.value : null;

    this.currentValue = nextValue;
    this.selectedIndex = value;
    this.onChange(nextValue);
    this.onTouched();
  }

  handleBlur(): void {
    this.onTouched();
  }

  private findSelectedIndex(value: ValueDropdownOption['value']): string {
    if (value === null || value === undefined) {
      return '';
    }

    const index = this.options.findIndex((option) => this.areValuesEqual(option.value, value));
    return index >= 0 ? String(index) : '';
  }

  private areValuesEqual(a: ValueDropdownOption['value'], b: ValueDropdownOption['value']): boolean {
    if (typeof a === 'number' || typeof b === 'number') {
      return Number(a) === Number(b);
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      return Boolean(a) === Boolean(b);
    }
    if (typeof a === 'string' || typeof b === 'string') {
      return String(a ?? '').trim() === String(b ?? '').trim();
    }
    return a === b;
  }
}
