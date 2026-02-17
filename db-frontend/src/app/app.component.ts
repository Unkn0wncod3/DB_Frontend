import { Component, DestroyRef, OnDestroy, OnInit } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { interval, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiStatusService } from './core/services/api-status.service';
import { AuthService, AuthenticatedUser } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule, NgFor, NgIf, FormsModule, DatePipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  readonly languages = ['en', 'de'];
  currentLang: string;
  readonly githubUrl = 'https://github.com/Unkn0wncod3';
  private statusIntervalSub?: Subscription;

  constructor(
    private readonly translate: TranslateService,
    readonly apiStatus: ApiStatusService,
    public readonly auth: AuthService,
    public readonly theme: ThemeService,
    private readonly destroyRef: DestroyRef
  ) {
    translate.addLangs(this.languages);
    translate.setDefaultLang('en');

    const browserLang = translate.getBrowserLang();
    const normalizedBrowserLang = typeof browserLang === 'string' ? browserLang.split('-')[0]?.toLowerCase() : undefined;
    const initialLang = normalizedBrowserLang && this.languages.includes(normalizedBrowserLang) ? normalizedBrowserLang : 'en';

    this.currentLang = initialLang;

    translate.onLangChange.subscribe(({ lang }) => {
      this.currentLang = lang;
    });

    translate.use(initialLang);

    this.auth
      .userChanges()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => this.applyUserPreferences(user));
  }

  changeLanguage(lang: string): void {
    if (!this.languages.includes(lang)) {
      return;
    }

    this.translate.use(lang);
    this.currentLang = lang;
  }

  ngOnInit(): void {
    this.apiStatus.refreshStatus();
    this.statusIntervalSub = interval(3600000).subscribe(() => this.apiStatus.refreshStatus());
  }

  ngOnDestroy(): void {
    this.statusIntervalSub?.unsubscribe();
  }

  refreshApiStatus(): void {
    this.apiStatus.refreshStatus();
  }

  logout(): void {
    this.auth.logout();
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  themeToggleLabelKey(): string {
    return this.theme.isDarkTheme() ? 'layout.theme.light' : 'layout.theme.dark';
  }

  scrollToTop(): void {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  private applyUserPreferences(user: AuthenticatedUser | null): void {
    if (!user?.preferences || typeof user.preferences !== 'object') {
      return;
    }

    const prefs = user.preferences as Record<string, unknown>;
    const languagePref = typeof prefs['language'] === 'string' ? (prefs['language'] as string) : null;
    if (languagePref && this.languages.includes(languagePref) && languagePref !== this.currentLang) {
      this.changeLanguage(languagePref);
    }

    const themePref = prefs['theme'];
    if (themePref === 'light' || themePref === 'dark') {
      this.theme.setTheme(themePref);
    } else if (themePref === 'system') {
      this.theme.applySystemPreference();
    }
  }
}
