import { DatePipe, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideIconData, icons as lucideIcons } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { LucideIconsModule } from '../../core/modules/lucide-icons.module';
import { EntrySchema } from '../../core/models/metadata.models';
import { SchemaService } from '../../core/services/schema.service';
import { DashboardSchemaTotal, StatsService } from '../../core/services/stats.service';

interface SchemaOverviewCard extends DashboardSchemaTotal {
  is_active: boolean;
  description?: string | null;
}

@Component({
  selector: 'app-schema-overview',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, DecimalPipe, RouterLink, TranslateModule, LucideIconsModule, ReactiveFormsModule],
  templateUrl: './schema-overview.component.html',
  styleUrl: './schema-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SchemaOverviewComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly statsService = inject(StatsService);
  private readonly schemaService = inject(SchemaService);
  private readonly translate = inject(TranslateService);
  readonly auth = inject(AuthService);

  readonly overview = this.statsService.overview;
  readonly isLoading = this.statsService.isLoading;
  readonly isSavingSchema = signal(false);
  readonly isDeletingSchema = signal(false);
  readonly isSchemaDialogOpen = signal(false);
  readonly isDeleteDialogOpen = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly dialogError = signal<string | null>(null);
  readonly editingSchema = signal<EntrySchema | null>(null);
  readonly showInactive = signal(false);
  readonly schemaList = signal<EntrySchema[]>([]);
  readonly schemas = computed<SchemaOverviewCard[]>(() => {
    const totals = new Map((this.overview()?.totals_per_schema ?? []).map((item) => [String(item.schema_id), item]));

    return this.schemaList().map((schema) => {
      const total = totals.get(String(schema.id));
      return {
        schema_id: schema.id,
        schema_key: schema.key,
        schema_name: schema.name,
        icon: schema.icon ?? null,
        total_entries: total?.total_entries ?? 0,
        last_created_at: total?.last_created_at ?? null,
        last_updated_at: total?.last_updated_at ?? null,
        is_active: schema.is_active,
        description: schema.description ?? null
      };
    });
  });
  readonly form = this.fb.nonNullable.group({
    key: ['', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
    name: ['', Validators.required],
    description: [''],
    icon: [''],
    is_active: [true]
  });

  readonly errorMessage = computed(() => {
    const error = this.statsService.error();
    if (!error) {
      return null;
    }

    const status = error.status || this.translate.instant('schemaOverview.errors.noStatus');
    const message =
      (typeof error.error === 'object' && error.error && 'message' in error.error
        ? String((error.error as { message?: unknown }).message ?? '')
        : '') ||
      error.message ||
      this.translate.instant('schemaOverview.errors.generic');

    return this.translate.instant('schemaOverview.errors.loadFailed', { status, message });
  });

  ngOnInit(): void {
    void this.reloadData();
  }

  refresh(): void {
    void this.reloadData(true);
  }

  toggleInactiveVisibility(): void {
    this.showInactive.update((value) => !value);
    void this.reloadData(true);
  }

  async openEditDialog(item: DashboardSchemaTotal): Promise<void> {
    if (!this.auth.canManageSchemas()) {
      return;
    }

    try {
      const schema = await firstValueFrom(this.schemaService.getSchema(item.schema_id));
      this.editingSchema.set(schema);
      this.form.reset({
        key: schema.key,
        name: schema.name,
        description: schema.description ?? '',
        icon: schema.icon ?? '',
        is_active: schema.is_active
      });
      this.isSchemaDialogOpen.set(true);
      this.successMessage.set(null);
      this.dialogError.set(null);
    } catch (error) {
      this.dialogError.set(this.describeMutationError(error));
    }
  }

  closeSchemaDialog(): void {
    this.isSchemaDialogOpen.set(false);
    this.editingSchema.set(null);
    this.dialogError.set(null);
  }

  openDeleteDialog(): void {
    if (!this.editingSchema()) {
      return;
    }

    this.isDeleteDialogOpen.set(true);
  }

  closeDeleteDialog(): void {
    this.isDeleteDialogOpen.set(false);
  }

  async saveSchema(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSavingSchema()) {
      return;
    }

    const raw = this.form.getRawValue();
    const payload = {
      key: raw.key.trim(),
      name: raw.name.trim(),
      description: raw.description.trim() || null,
      icon: raw.icon.trim() || null,
      is_active: raw.is_active
    };

    this.isSavingSchema.set(true);
    this.successMessage.set(null);
    this.dialogError.set(null);

    try {
      const current = this.editingSchema();
      if (current) {
        await firstValueFrom(this.schemaService.updateSchema(current.id, payload));
        this.successMessage.set(this.translate.instant('schemaOverview.status.updated', { value: payload.name }));
      } else {
        await firstValueFrom(this.schemaService.createSchema(payload));
        this.successMessage.set(this.translate.instant('schemaOverview.status.created', { value: payload.name }));
      }

      this.closeSchemaDialog();
      await this.reloadData(true);
    } catch (error) {
      this.dialogError.set(this.describeMutationError(error));
    } finally {
      this.isSavingSchema.set(false);
    }
  }

  async deleteSchema(): Promise<void> {
    const schema = this.editingSchema();
    if (!schema || this.isDeletingSchema()) {
      return;
    }

    this.isDeletingSchema.set(true);
    this.dialogError.set(null);
    this.successMessage.set(null);

    try {
      await firstValueFrom(this.schemaService.deleteSchema(schema.id));
      this.successMessage.set(this.translate.instant('schemaOverview.status.deleted', { value: schema.name }));
      this.closeDeleteDialog();
      this.closeSchemaDialog();
      await this.reloadData(true);
    } catch (error) {
      this.dialogError.set(this.describeMutationError(error));
      this.closeDeleteDialog();
    } finally {
      this.isDeletingSchema.set(false);
    }
  }

  trackSchema(_index: number, item: DashboardSchemaTotal): string {
    return `${item.schema_key}-${item.schema_id}`;
  }

  schemaLink(item: DashboardSchemaTotal): string[] {
    return ['/entries', item.schema_key];
  }

  resolveLucideIcon(icon: string | null | undefined): LucideIconData | null {
    const normalized = (icon ?? '').trim();
    if (!normalized) {
      return null;
    }

    const key = normalized
      .split(/[-_\s]+/)
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    const match = (lucideIcons as Record<string, LucideIconData | undefined>)[key];
    return match ?? null;
  }

  iconFallbackLabel(item: DashboardSchemaTotal): string {
    const source = item.schema_name?.trim() || item.schema_key?.trim() || '?';
    return source.charAt(0).toUpperCase();
  }

  dialogTitle(): string {
    return this.translate.instant('schemaOverview.dialog.editTitle');
  }

  dialogSubtitle(): string {
    return this.translate.instant('schemaOverview.dialog.editSubtitle');
  }

  dialogSubmitLabel(): string {
    return this.translate.instant('schemaOverview.actions.save');
  }

  inactiveToggleLabel(): string {
    return this.showInactive()
      ? this.translate.instant('schemaOverview.actions.hideInactive')
      : this.translate.instant('schemaOverview.actions.showInactive');
  }

  private async reloadData(forceRefresh = false): Promise<void> {
    await Promise.all([
      this.statsService.loadOverview(forceRefresh),
      firstValueFrom(this.schemaService.loadSchemas(forceRefresh, this.showInactive())).then((schemas) => {
        this.schemaList.set(schemas);
      })
    ]);
  }

  private describeMutationError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message?: unknown }).message ?? '');
    }
    return this.translate.instant('schemaOverview.errors.generic');
  }
}
