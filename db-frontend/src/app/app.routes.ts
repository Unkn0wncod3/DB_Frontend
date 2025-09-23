import { Routes } from '@angular/router';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ApiExplorerComponent } from './features/api-explorer/api-explorer.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'explorer', component: ApiExplorerComponent },
  { path: '**', redirectTo: '' }
];

