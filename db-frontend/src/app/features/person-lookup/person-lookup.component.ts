import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, forwardRef, inject, signal } from '@angular/core';
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
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly searchControl = this.fb.nonNullable.control('');
  readonly results = signal<PersonOption[]>([]);
  readonly isOpen = signal(false);
  readonly isLoading = signal(false);
  readonly selectedId = signal<string | null>(null);

  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};
  private isDisabled = false;

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.handleInputChange(value ?? '');
      });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) {
      return;
    }
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.closeSearch();
    }
  }

  writeValue(value: string | number | null): void {
    if (!value) {
      this.selectedId.set(null);
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
    this.searchControl.setValue(option.label, { emitEvent: false });
    this.selectedId.set(option.id || null);
    this.onChange(option.id);
    this.closeSearch();
  }

  clearSelection(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.selectedId.set(null);
    this.onChange(null);
    this.onTouched();
    this.results.set([]);
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

  trackByOption(_index: number, option: PersonOption): string {
    return option.id || option.label;
  }

  private handleInputChange(rawValue: string): void {
    const value = (rawValue ?? '').trim();

    if (!value) {
      this.selectedId.set(null);
      this.onChange(null);
      if (this.isOpen()) {
        void this.performSearch('');
      }
      return;
    }

    if (/^\d+$/.test(value)) {
      this.selectedId.set(value);
      this.onChange(value);
      this.closeSearch();
      return;
    }

    this.selectedId.set(null);
    this.onChange(null);
    if (this.isOpen()) {
      void this.performSearch(value);
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
      this.selectedId.set(option.id || null);
      this.searchControl.setValue(option.label, { emitEvent: false });
    } catch {
      const fallback = value.toString();
      this.selectedId.set(fallback);
      this.searchControl.setValue(value.toString(), { emitEvent: false });
    }
  }
}
