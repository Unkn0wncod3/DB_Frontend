import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CreateFieldPayload, CreateSchemaPayload, FieldDataType } from '../../core/models/metadata.models';
import { humanizeKey } from '../../core/utils/schema.utils';

export interface SchemaEditorSubmitPayload {
  schema: CreateSchemaPayload;
  fields: CreateFieldPayload[];
}

@Component({
  selector: 'app-schema-editor-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule],
  templateUrl: './schema-editor-form.component.html',
  styleUrl: './schema-editor-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SchemaEditorFormComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly defaultSchemaIcon = 'file-text';

  @Input() submitLabel = '';
  @Input() submitBusy = false;
  @Input() submitError: string | null = null;
  @Input() initialSchema: Partial<CreateSchemaPayload> | null = null;
  @Input() initialFields: CreateFieldPayload[] = [];
  @Input() allowFieldDrafts = true;

  @Output() submitted = new EventEmitter<SchemaEditorSubmitPayload>();

  readonly dataTypeOptions: FieldDataType[] = [
    'text',
    'long_text',
    'integer',
    'decimal',
    'boolean',
    'date',
    'datetime',
    'email',
    'url',
    'select',
    'multi_select',
    'reference',
    'file',
    'json'
  ];

  readonly schemaForm = this.fb.nonNullable.group({
    key: ['', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
    name: ['', Validators.required],
    description: [''],
    icon: [''],
    is_active: [true]
  });

  readonly fieldForm = this.fb.nonNullable.group({
    label: ['', Validators.required],
    key: ['', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
    description: [''],
    data_type: ['text' as FieldDataType, Validators.required],
    is_required: [false],
    is_unique: [false],
    options: [''],
    reference_schema_key: ['']
  });

  readonly fieldDrafts = signal<CreateFieldPayload[]>([]);
  readonly isFieldDialogOpen = signal(false);
  readonly editingFieldIndex = signal<number | null>(null);
  readonly humanizeKey = humanizeKey;
  private schemaKeyAutoSync = true;
  private fieldKeyAutoSync = true;

  constructor() {
    this.resetSchemaFormForCreate();

    this.schemaForm.controls.name.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.syncSchemaKeyFromName(value));

    this.fieldForm.controls.label.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.syncFieldKeyFromLabel(value));
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialSchema']) {
      if (this.initialSchema) {
        this.schemaKeyAutoSync = false;
        this.schemaForm.reset({
          key: this.initialSchema.key ?? '',
          name: this.initialSchema.name ?? '',
          description: this.initialSchema.description ?? '',
          icon: this.initialSchema.icon ?? this.defaultSchemaIcon,
          is_active: this.initialSchema.is_active ?? true
        });
      } else {
        this.resetSchemaFormForCreate();
      }
    }

    if (changes['initialFields']) {
      this.fieldDrafts.set((this.initialFields ?? []).map((field) => this.cloneField(field)));
    }
  }

  submit(): void {
    this.schemaForm.markAllAsTouched();
    if (this.schemaForm.invalid || this.submitBusy) {
      return;
    }

    const raw = this.schemaForm.getRawValue();
    this.submitted.emit({
      schema: {
        key: raw.key.trim(),
        name: raw.name.trim(),
        description: raw.description.trim() || null,
        icon: raw.icon.trim() || null,
        is_active: raw.is_active
      },
      fields: this.fieldDrafts().map((field, index) => ({
        ...this.cloneField(field),
        sort_order: field.sort_order ?? (index + 1) * 10
      }))
    });
  }

  openCreateFieldDialog(): void {
    this.fieldKeyAutoSync = true;
    this.fieldForm.reset({
      label: '',
      key: '',
      description: '',
      data_type: 'text',
      is_required: false,
      is_unique: false,
      options: '',
      reference_schema_key: ''
    });
    this.editingFieldIndex.set(null);
    this.isFieldDialogOpen.set(true);
  }

  openEditFieldDialog(index: number): void {
    const field = this.fieldDrafts()[index];
    if (!field) {
      return;
    }

    this.fieldKeyAutoSync = false;

    const options = Array.isArray(field.settings_json?.['options']) ? field.settings_json?.['options'] : [];
    const referenceSchemaKey =
      typeof field.settings_json?.['reference_schema_key'] === 'string' ? field.settings_json['reference_schema_key'] : '';

    this.fieldForm.reset({
      label: field.label,
      key: field.key,
      description: field.description ?? '',
      data_type: field.data_type,
      is_required: field.is_required ?? false,
      is_unique: field.is_unique ?? false,
      options: options.map((item) => String(item)).join(', '),
      reference_schema_key: referenceSchemaKey
    });
    this.editingFieldIndex.set(index);
    this.isFieldDialogOpen.set(true);
  }

  closeFieldDialog(): void {
    this.isFieldDialogOpen.set(false);
    this.editingFieldIndex.set(null);
  }

  saveFieldDraft(): void {
    this.fieldForm.markAllAsTouched();
    if (this.fieldForm.invalid) {
      return;
    }

    const raw = this.fieldForm.getRawValue();
    const normalizedKey = this.normalizeKey(raw.key || raw.label);
    const settingsJson: Record<string, unknown> = {};

    if (raw.data_type === 'select' || raw.data_type === 'multi_select') {
      const options = raw.options
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (options.length > 0) {
        settingsJson['options'] = options;
      }
    }

    if (raw.data_type === 'reference') {
      const referenceSchemaKey = raw.reference_schema_key.trim();
      if (referenceSchemaKey) {
        settingsJson['reference_schema_key'] = referenceSchemaKey;
      }
    }

    const nextField: CreateFieldPayload = {
      key: normalizedKey,
      label: raw.label.trim(),
      description: raw.description.trim() || null,
      data_type: raw.data_type,
      is_required: raw.is_required,
      is_unique: raw.is_unique,
      is_active: true,
      sort_order: this.resolveSortOrder(),
      settings_json: Object.keys(settingsJson).length > 0 ? settingsJson : {}
    };

    const index = this.editingFieldIndex();
    if (index === null) {
      this.fieldDrafts.set([...this.fieldDrafts(), nextField]);
    } else {
      this.fieldDrafts.set(
        this.fieldDrafts().map((field, fieldIndex) =>
          fieldIndex === index ? { ...field, ...nextField, sort_order: field.sort_order } : field
        )
      );
    }

    this.closeFieldDialog();
  }

  deleteFieldDraft(index: number): void {
    this.fieldDrafts.set(this.fieldDrafts().filter((_field, fieldIndex) => fieldIndex !== index));
    if (this.editingFieldIndex() === index) {
      this.closeFieldDialog();
    }
  }

  deleteEditingField(): void {
    const index = this.editingFieldIndex();
    if (index === null) {
      return;
    }

    this.deleteFieldDraft(index);
  }

  fieldTypeLabel(type: FieldDataType): string {
    const translationKey = `entryForm.types.${type}`;
    const translated = this.translate.instant(translationKey);
    return translated !== translationKey ? translated : humanizeKey(type);
  }

  onSchemaKeyInput(): void {
    const currentValue = this.schemaForm.controls.key.value.trim();
    const generatedValue = this.normalizeKey(this.schemaForm.controls.name.value);
    this.schemaKeyAutoSync = currentValue.length === 0 || currentValue === generatedValue;
  }

  onFieldKeyInput(): void {
    const currentValue = this.fieldForm.controls.key.value.trim();
    const generatedValue = this.normalizeKey(this.fieldForm.controls.label.value);
    this.fieldKeyAutoSync = currentValue.length === 0 || currentValue === generatedValue;
  }

  fieldSummary(field: CreateFieldPayload): string {
    const parts = [this.fieldTypeLabel(field.data_type)];
    if (field.is_required) {
      parts.push(this.translate.instant('schemaEditor.fieldBadges.required'));
    }
    if (field.is_unique) {
      parts.push(this.translate.instant('schemaEditor.fieldBadges.unique'));
    }
    return parts.join(' • ');
  }

  fieldCardDescription(field: CreateFieldPayload): string {
    const description = field.description?.trim();
    return description || this.translate.instant('schemaEditor.fieldDrafts.noDescription');
  }

  shouldShowOptionsInput(): boolean {
    const type = this.fieldForm.controls.data_type.value;
    return type === 'select' || type === 'multi_select';
  }

  shouldShowReferenceSchemaInput(): boolean {
    return this.fieldForm.controls.data_type.value === 'reference';
  }

  onLabelBlur(): void {
    const keyControl = this.fieldForm.controls.key;
    const labelValue = this.fieldForm.controls.label.value;
    if (!keyControl.value.trim()) {
      keyControl.setValue(this.normalizeKey(labelValue));
    }
  }

  keyPreview(): string {
    const key = this.schemaForm.controls.key.value.trim();
    if (key) {
      return key;
    }
    const name = this.schemaForm.controls.name.value.trim();
    return name ? this.normalizeKey(name) : 'schema_key';
  }

  private normalizeKey(value: string): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private syncSchemaKeyFromName(value: string): void {
    if (!this.schemaKeyAutoSync) {
      return;
    }

    this.schemaForm.controls.key.setValue(this.normalizeKey(value), { emitEvent: false });
  }

  private syncFieldKeyFromLabel(value: string): void {
    if (!this.fieldKeyAutoSync) {
      return;
    }

    this.fieldForm.controls.key.setValue(this.normalizeKey(value), { emitEvent: false });
  }

  private resetSchemaFormForCreate(): void {
    this.schemaKeyAutoSync = true;
    this.schemaForm.reset({
      key: '',
      name: '',
      description: '',
      icon: this.defaultSchemaIcon,
      is_active: true
    });
  }

  private resolveSortOrder(): number {
    return (this.fieldDrafts().length + 1) * 10;
  }

  private cloneField(field: CreateFieldPayload): CreateFieldPayload {
    return {
      ...field,
      description: field.description ?? null,
      settings_json: field.settings_json ? { ...field.settings_json } : {},
      validation_json: field.validation_json ? { ...field.validation_json } : {}
    };
  }
}
