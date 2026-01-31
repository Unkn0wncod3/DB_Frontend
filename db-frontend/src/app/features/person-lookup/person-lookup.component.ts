import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, FormBuilder, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { EntryService } from '../../core/services/entry.service';
import { firstValueFrom } from 'rxjs';

interface PersonOption {
  id: string;
  label: string;
  email?: string;
  status?: string;
}

@Component({
  selector: 'app-person-lookup',
  standalone: true,
  imports: [ReactiveFormsModule, NgIf, NgFor, TranslateModule],
  templateUrl: './person-lookup.component.html',
  styleUrl: './person-lookup.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PersonLookupComponent),
      multi: true
    }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonLookupComponent implements ControlValueAccessor {
  private readonly fb = inject(FormBuilder);
  private readonly entryService = inject(EntryService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchControl = this.fb.nonNullable.control('');
  readonly results = signal<PersonOption[]>([]);
  readonly isOpen = signal(false);
  readonly isLoading = signal(false);
  readonly selectedLabel = signal('');

  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};
  private isDisabled = false;

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        if (!this.isOpen()) {
          return;
        }
        void this.performSearch(value ?? '');
      });
  }

  writeValue(value: string | number | null): void {
    if (!value) {
      this.selectedLabel.set('');
      this.searchControl.setValue('', { emitEvent: false });
      return;
    }

    void this.hydrateSelection(value);
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
    if (isDisabled) {
      this.searchControl.disable({ emitEvent: false });
    } else {
      this.searchControl.enable({ emitEvent: false });
    }
  }

  openSearch(): void {
    if (this.isDisabled) {
      return;
    }
    this.isOpen.set(true);
    void this.performSearch(this.searchControl.value ?? '');
  }

  closeSearch(): void {
    this.isOpen.set(false);
    this.results.set([]);
  }

  selectOption(option: PersonOption): void {
    this.selectedLabel.set(option.label);
    this.searchControl.setValue(option.label, { emitEvent: false });
    this.onChange(option.id);
    this.closeSearch();
  }

  clearSelection(): void {
    this.selectedLabel.set('');
    this.searchControl.setValue('', { emitEvent: false });
    this.onChange(null);
    this.onTouched();
  }

  async performSearch(term: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const params = {
        search: term,
        page: 1,
        pageSize: 8
      };
      const result = await firstValueFrom(this.entryService.listEntries('persons', params));
      const options = (result.items ?? []).map((item) => this.toOption(item));
      this.results.set(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.translate.instant('entryList.errors.unknown');
      this.results.set([{ id: '', label: message }]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private toOption(record: Record<string, unknown>): PersonOption {
    const id = this.extractId(record);
    const name = this.composeName(record);
    const email = typeof record['email'] === 'string' ? record['email'] : undefined;
    const status = typeof record['status'] === 'string' ? record['status'] : undefined;
    return {
      id: id ?? '',
      label: name || email || id || this.translate.instant('personLookup.unknown'),
      email,
      status
    };
  }

  private composeName(record: Record<string, unknown>): string {
    const first = typeof record['first_name'] === 'string' ? record['first_name'] : '';
    const last = typeof record['last_name'] === 'string' ? record['last_name'] : '';
    return [first, last].filter((value) => value.length > 0).join(' ').trim();
  }

  private extractId(record: Record<string, unknown>): string | undefined {
    const value = record['id'] ?? record['_id'];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    return undefined;
  }

  private async hydrateSelection(value: string | number): Promise<void> {
    try {
      const result = await firstValueFrom(this.entryService.getEntry('persons', value.toString()));
      const option = this.toOption(result as Record<string, unknown>);
      this.selectedLabel.set(option.label);
      this.searchControl.setValue(option.label, { emitEvent: false });
    } catch {
      this.selectedLabel.set(value.toString());
      this.searchControl.setValue(value.toString(), { emitEvent: false });
    }
  }
}
