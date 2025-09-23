import { HttpErrorResponse } from '@angular/common/http';
import { JsonPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, Inject, computed, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ApiService, HttpMethod, RequestOptions } from '../../core/services/api.service';
import { API_BASE_URL } from '../../core/tokens/api-base-url.token';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [NgIf, NgFor, ReactiveFormsModule, JsonPipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent {
  readonly methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  readonly form = this.fb.nonNullable.group({
    method: this.fb.nonNullable.control<HttpMethod>('GET'),
    endpoint: this.fb.nonNullable.control<string>('/health'),
    body: this.fb.nonNullable.control<string>(''),
    headers: this.fb.nonNullable.control<string>('')
  });
  readonly requiresBody = computed(() => this.methodsRequiringBody.has(this.form.controls.method.value));
  readonly isLoading = signal(false);
  readonly response = signal<unknown | null>(null);
  readonly error = signal<string | null>(null);

  private readonly methodsRequiringBody = new Set<HttpMethod>(['POST', 'PUT', 'PATCH']);

  constructor(
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
    @Inject(API_BASE_URL) readonly baseUrl: string
  ) {}

  async submit(): Promise<void> {
    if (this.form.invalid) {
      return;
    }

    this.response.set(null);
    this.error.set(null);

    const { method, endpoint, body, headers } = this.form.getRawValue();

    let requestOptions: RequestOptions;
    try {
      requestOptions = this.createRequestOptions(method, body, headers);
    } catch (err) {
      this.error.set(this.stringifyError(err));
      return;
    }

    this.isLoading.set(true);

    try {
      const result = await firstValueFrom(this.api.request<unknown>(method, endpoint, requestOptions));
      this.response.set(result);
    } catch (err) {
      this.error.set(this.stringifyError(err));
    } finally {
      this.isLoading.set(false);
    }
  }

  private createRequestOptions(method: HttpMethod, body: string, headers: string): RequestOptions {
    const options: RequestOptions = {};

    if (this.methodsRequiringBody.has(method) && body.trim().length > 0) {
      options.body = this.parseJson(body, 'Body');
    }

    if (headers.trim().length > 0) {
      options.headers = this.parseJson(headers, 'Headers');
    }

    return options;
  }

  private parseJson(content: string, label: string) {
    try {
      return JSON.parse(content);
    } catch {
      throw new Error(`${label}-Feld enthaelt kein gueltiges JSON.`);
    }
  }

  private stringifyError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const statusText = error.status ? ` (Status ${error.status})` : '';
      const message = typeof error.error === 'string' && error.error.trim().length > 0
        ? error.error
        : error.message;
      return `${message}${statusText}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message ?? 'Unbekannter Fehler');
    }

    return 'Unbekannter Fehler';
  }
}
