import { Routes } from '@angular/router';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ApiExplorerComponent } from './features/api-explorer/api-explorer.component';
import { EntryDetailComponent } from './features/entry-detail/entry-detail.component';
import { EntryListComponent } from './features/entry-list/entry-list.component';
import { EntryCreateComponent } from './features/entry-create/entry-create.component';
import { ActivitiesTimelineComponent } from './features/activities-timeline/activities-timeline.component';
import { ContactComponent } from './features/info/contact.component';
import { ImprintComponent } from './features/info/imprint.component';
import { LoginComponent } from './features/auth/login.component';
import { ProfileComponent } from './features/profile/profile.component';
import { UserManagementComponent } from './features/users/user-management.component';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'entries/:type/new', component: EntryCreateComponent, canActivate: [authGuard, adminGuard] },
  { path: 'entries/activities/timeline', component: ActivitiesTimelineComponent, canActivate: [authGuard] },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'entries/:type', component: EntryListComponent, canActivate: [authGuard] },
  { path: 'entries/:type/:id', component: EntryDetailComponent, canActivate: [authGuard] },
  { path: 'explorer', component: ApiExplorerComponent, canActivate: [authGuard, adminGuard] },
  { path: 'admin/users', component: UserManagementComponent, canActivate: [authGuard, adminGuard] },
  { path: 'contact', component: ContactComponent },
  { path: 'imprint', component: ImprintComponent },
  { path: '**', redirectTo: '' }
];
