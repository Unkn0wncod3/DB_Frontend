import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-entry-detail-delete-dialog',
  standalone: true,
  imports: [NgIf, TranslateModule],
  templateUrl: './entry-detail-delete-dialog.component.html',
  styleUrls: ['./entry-detail-delete-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryDetailDeleteDialogComponent implements OnChanges {
  private readonly translate = inject(TranslateService);

  @Input({ required: true }) securityKey = '';
  @Input() isOpen = false;
  @Input() isDeleting = false;

  @Output() confirmed = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  readonly deletePasscode = signal('');
  readonly errorMessage = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if ('isOpen' in changes) {
      if (this.isOpen) {
        this.resetState();
      } else {
        this.deletePasscode.set('');
        this.errorMessage.set(null);
      }
    }
  }

  onPasscodeInput(value: string): void {
    this.deletePasscode.set(value);
    if (this.errorMessage()) {
      this.errorMessage.set(null);
    }
  }

  canConfirm(): boolean {
    return this.deletePasscode().trim() === this.securityKey && !this.isDeleting;
  }

  attemptConfirm(): void {
    if (!this.canConfirm()) {
      this.errorMessage.set(this.translate.instant('entryDetail.delete.passcodeInvalid'));
      return;
    }

    this.errorMessage.set(null);
    this.confirmed.emit();
  }

  requestClose(): void {
    if (this.isDeleting) {
      return;
    }
    this.closed.emit();
  }

  private resetState(): void {
    this.deletePasscode.set('');
    this.errorMessage.set(null);
  }
}
