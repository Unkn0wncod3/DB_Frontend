import { Routes } from '@angular/router';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ApiExplorerComponent } from './features/api-explorer/api-explorer.component';
import { EntryDetailComponent } from './features/entry-detail/entry-detail.component';
import { EntryListComponent } from './features/entry-list/entry-list.component';
import { EntryCreateComponent } from './features/entry-create/entry-create.component';
import { ActivitiesTimelineComponent } from './features/activities-timeline/activities-timeline.component';
import { ContactComponent } from './features/info/contact.component';
import { ImprintComponent } from './features/info/imprint.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'entries/:type/new', component: EntryCreateComponent },
  { path: 'entries/activities/timeline', component: ActivitiesTimelineComponent },
  { path: 'entries/:type', component: EntryListComponent },
  { path: 'entries/:type/:id', component: EntryDetailComponent },
  { path: 'explorer', component: ApiExplorerComponent },
  { path: 'contact', component: ContactComponent },
  { path: 'imprint', component: ImprintComponent },
  { path: '**', redirectTo: '' }
];
