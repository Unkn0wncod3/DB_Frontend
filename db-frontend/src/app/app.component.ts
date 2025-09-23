import { Component } from '@angular/core';
import { NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule, NgFor, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly languages = ['en', 'de'];
  currentLang: string;

  constructor(private readonly translate: TranslateService) {
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
}
