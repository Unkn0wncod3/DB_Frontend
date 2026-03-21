import { CanDeactivateFn } from '@angular/router';

import { EntryDetailComponent } from '../../features/entry-detail/entry-detail.component';

export const pendingEntryChangesGuard: CanDeactivateFn<EntryDetailComponent> = (component) => component.confirmDiscardChanges();
