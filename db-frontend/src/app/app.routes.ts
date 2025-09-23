import { Routes } from '@angular/router';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { HomeComponent } from './features/home/home.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'explorer', component: HomeComponent },
  { path: '**', redirectTo: '' }
];
