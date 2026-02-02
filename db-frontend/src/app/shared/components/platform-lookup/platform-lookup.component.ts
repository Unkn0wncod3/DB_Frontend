import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, FormBuilder, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

import { EntryService } from '../../../core/services/entry.service';

interface PlatformOption {
  id: string;
  label: string;
  baseUrl?: string;
  category?: string;
  isActive?: boolean;
}

@Component({
  selector: 'app-platform-lookup',
  standalone: true,
  imports: [ReactiveFormsModule, NgIf, NgFor, TranslateModule],
  templateUrl: './platform-lookup.component.html',
  styleUrl: './platform-lookup.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PlatformLookupComponent),
      multi: true
    }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlatformLookupComponent implements ControlValueAccessor {
  private readonly fb = inject(FormBuilder);
  private readonly entryService = inject(EntryService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly searchControl = this.fb.nonNullable.control('');
  readonly results = signal<PlatformOption[]>([]);
  readonly isOpen = signal(false);
  readonly isLoading = signal(false);
  readonly selectedId = signal<string | null>(null);

  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};
  private isDisabled = false;

  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.handleInputChange(value ?? ''));
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

  selectOption(option: PlatformOption): void {
    this.selectedId.set(option.id);
    this.searchControl.setValue(option.label, { emitEvent: false });
    this.onChange(option.id);
    this.closeSearch();
  }

  clearSelection(): void {
    this.selectedId.set(null);
    this.searchControl.setValue('', { emitEvent: false });
    this.onChange(null);
    this.onTouched();
    this.results.set([]);
  }

  trackByOption(_index: number, option: PlatformOption): string {
    return option.id || option.label;
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
      return;
    }

    this.selectedId.set(null);
    this.onChange(null);
    if (this.isOpen()) {
      void this.performSearch(value);
    }
  }

  private async performSearch(term: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const params = {
        search: term,
        page: 1,
        pageSize: 8
      };
      const result = await firstValueFrom(this.entryService.listEntries('platforms', params));
      const options = (result.items ?? []).map((item) => this.toOption(item));
      this.results.set(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.translate.instant('platformLookup.error');
      this.results.set([{ id: '', label: message }]);
    } finally {
      this.isLoading.set(false);
    }
  }

  private toOption(record: Record<string, unknown>): PlatformOption {
    const id = this.extractId(record);
    const name = typeof record['name'] === 'string' ? record['name'] : id ?? '';
    const baseUrl = typeof record['base_url'] === 'string' ? record['base_url'] : undefined;
    const category = typeof record['category'] === 'string' ? record['category'] : undefined;
    const isActive = typeof record['is_active'] === 'boolean' ? record['is_active'] : undefined;
    return {
      id: id ?? '',
      label: name || baseUrl || id || this.translate.instant('platformLookup.unknown'),
      baseUrl,
      category,
      isActive
    };
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
      const result = await firstValueFrom(this.entryService.getEntry('platforms', value.toString()));
      const option = this.toOption(result as Record<string, unknown>);
      this.selectedId.set(option.id || null);
      this.searchControl.setValue(option.label, { emitEvent: false });
    } catch {
      const fallback = value.toString();
      this.selectedId.set(fallback);
      this.searchControl.setValue(fallback, { emitEvent: false });
    }
  }
}
