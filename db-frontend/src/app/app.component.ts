import { NgFor } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule, NgFor],
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
    const initialLang = browserLang && this.languages.includes(browserLang) ? browserLang : 'en';

    translate.use(initialLang);
    this.currentLang = translate.currentLang || initialLang;
  }

  onLanguageChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (!target) {
      return;
    }

    this.changeLanguage(target.value);
  }

  changeLanguage(lang: string): void {
    if (!this.languages.includes(lang)) {
      return;
    }

    this.translate.use(lang);
    this.currentLang = lang;
  }
}
