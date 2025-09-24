import { Routes } from '@angular/router';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ApiExplorerComponent } from './features/api-explorer/api-explorer.component';
import { EntryDetailComponent } from './features/entry-detail/entry-detail.component';
import { EntryListComponent } from './features/entry-list/entry-list.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'entries/:type', component: EntryListComponent },
  { path: 'entries/:type/:id', component: EntryDetailComponent },
  { path: 'explorer', component: ApiExplorerComponent },
  { path: '**', redirectTo: '' }
];

