import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewChild, forwardRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, FormBuilder, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

export interface EntityLookupOption {
  id: string;
  label: string;
  idLabel?: string | null;
  description?: string | null;
  meta?: string | null;
  status?: string | null;
}

export interface EntityLookupConfig {
  accessibleLabel: string;
  placeholder: string;
  clearLabel: string;
  loadingLabel: string;
  noResultsLabel: string;
  closeLabel: string;
  allowDirectIdEntry?: boolean;
  search: (term: string) => Promise<EntityLookupOption[]>;
  hydrate: (value: string | number) => Promise<EntityLookupOption | null>;
}

@Component({
  selector: 'app-entity-lookup',
  standalone: true,
  imports: [ReactiveFormsModule, NgIf, NgFor, TranslateModule],
  templateUrl: './entity-lookup.component.html',
  styleUrl: './entity-lookup.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => EntityLookupComponent),
      multi: true
    }
  ],
  host: {
    class: 'entity-lookup-host'
  },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntityLookupComponent implements ControlValueAccessor {
  readonly config = input.required<EntityLookupConfig>();
  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly searchControl = this.fb.nonNullable.control('');
  readonly results = signal<EntityLookupOption[]>([]);
  readonly isOpen = signal(false);
  readonly isLoading = signal(false);
  readonly selectedId = signal<string | null>(null);

  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};
  private isDisabled = false;
  private requestSequence = 0;

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
    if (value == null || String(value).trim().length === 0) {
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
      return;
    }

    this.searchControl.enable({ emitEvent: false });
  }

  openSearch(): void {
    if (this.isDisabled) {
      return;
    }

    this.isOpen.set(true);
    this.onTouched();
    void this.performSearch(this.selectedId() ? '' : (this.searchControl.value ?? ''));
  }

  closeSearch(): void {
    this.isOpen.set(false);
    this.results.set([]);
  }

  selectOption(option: EntityLookupOption): void {
    this.searchControl.setValue(option.label, { emitEvent: false });
    this.selectedId.set(option.id || null);
    this.onChange(option.id || null);
    this.onTouched();
    this.closeSearch();
  }

  clearSelection(): void {
    this.searchControl.setValue('', { emitEvent: false });
    this.selectedId.set(null);
    this.onChange(null);
    this.onTouched();
    this.isOpen.set(true);
    void this.performSearch('');
    queueMicrotask(() => {
      this.searchInput?.nativeElement.focus();
    });
  }

  trackByOption(_index: number, option: EntityLookupOption): string {
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

    if (this.config().allowDirectIdEntry !== false && /^\d+$/.test(value)) {
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

  private async performSearch(term: string): Promise<void> {
    const requestId = ++this.requestSequence;
    this.isLoading.set(true);

    try {
      const options = await this.config().search(term.trim());
      if (requestId === this.requestSequence) {
        this.results.set(options);
      }
    } catch {
      if (requestId === this.requestSequence) {
        this.results.set([]);
      }
    } finally {
      if (requestId === this.requestSequence) {
        this.isLoading.set(false);
      }
    }
  }

  private async hydrateSelection(value: string | number): Promise<void> {
    try {
      const option = await this.config().hydrate(value);
      if (!option) {
        throw new Error('Missing lookup option');
      }

      this.selectedId.set(option.id || null);
      this.searchControl.setValue(option.label, { emitEvent: false });
    } catch {
      const fallback = String(value).trim();
      this.selectedId.set(fallback || null);
      this.searchControl.setValue(fallback, { emitEvent: false });
    }
  }
}
