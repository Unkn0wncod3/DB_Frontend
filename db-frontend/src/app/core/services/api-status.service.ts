import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ApiStatusService {
  private readonly endpoint = 'https://dbmanager-production.up.railway.app/';

  readonly status = signal<'online' | 'offline' | 'unknown'>('unknown');
  readonly lastChecked = signal<Date | null>(null);
  readonly isChecking = signal(false);

  constructor(private readonly http: HttpClient) {}

  refreshStatus(): void {
    if (this.isChecking()) {
      return;
    }

    this.isChecking.set(true);

    this.http
      .get<{ status?: string }>(this.endpoint)
      .pipe(finalize(() => this.isChecking.set(false)))
      .subscribe({
        next: (response) => {
          const ok = (response?.status ?? '').toLowerCase() === 'ok';
          this.status.set(ok ? 'online' : 'offline');
          this.lastChecked.set(new Date());
        },
        error: () => {
          this.status.set('offline');
          this.lastChecked.set(new Date());
        }
      });
  }
}
