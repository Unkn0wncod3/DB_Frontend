import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { interval, Subscription } from 'rxjs';

import { ApiStatusService } from './core/services/api-status.service';
import { AuthService } from './core/services/auth.service';

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
  readonly githubUrl = 'https://github.com/placeholder/repo';
  private statusIntervalSub?: Subscription;

  constructor(
    private readonly translate: TranslateService,
    readonly apiStatus: ApiStatusService,
    public readonly auth: AuthService
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
}
