import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'dbfrontend.theme';
  private readonly document = inject(DOCUMENT, { optional: true });
  private readonly initialTheme: ThemePreference = this.loadStoredTheme();
  private readonly themeSignal = signal<ThemePreference>(this.initialTheme);

  constructor() {
    this.applyTheme(this.themeSignal());
  }

  theme(): ThemePreference {
    return this.themeSignal();
  }

  isDarkTheme(): boolean {
    return this.themeSignal() === 'dark';
  }

  setTheme(theme: ThemePreference): void {
    if (theme === this.themeSignal()) {
      return;
    }
    this.themeSignal.set(theme);
    this.storeTheme(theme);
    this.applyTheme(theme);
  }

  toggleTheme(): void {
    this.setTheme(this.isDarkTheme() ? 'light' : 'dark');
  }

  private loadStoredTheme(): ThemePreference {
    if (typeof window === 'undefined') {
      return 'light';
    }
    const stored = window.localStorage.getItem(this.storageKey) as ThemePreference | null;
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  private storeTheme(theme: ThemePreference): void {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(this.storageKey, theme);
  }

  private applyTheme(theme: ThemePreference): void {
    const doc = this.document?.documentElement;
    if (doc) {
      doc.setAttribute('data-theme', theme);
    }
  }
}
