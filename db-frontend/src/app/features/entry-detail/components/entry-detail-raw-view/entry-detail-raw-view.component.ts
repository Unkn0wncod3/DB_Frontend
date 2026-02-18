import { JsonPipe, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-entry-detail-raw-view',
  standalone: true,
  imports: [NgIf, JsonPipe, TranslateModule],
  templateUrl: './entry-detail-raw-view.component.html',
  styleUrls: ['./entry-detail-raw-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryDetailRawViewComponent {
  @Input() record: unknown;
  @Input() activated = true;
}
