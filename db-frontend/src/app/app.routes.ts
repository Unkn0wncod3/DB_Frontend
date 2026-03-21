import { Routes } from '@angular/router';

import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ApiExplorerComponent } from './features/api-explorer/api-explorer.component';
import { EntryDetailComponent } from './features/entry-detail/entry-detail.component';
import { EntryListComponent } from './features/entry-list/entry-list.component';
import { EntryCreateComponent } from './features/entry-create/entry-create.component';
import { ActivitiesTimelineComponent } from './features/activities-timeline/activities-timeline.component';
import { MyEntriesComponent } from './features/my-entries/my-entries.component';
import { ContactComponent } from './features/info/contact.component';
import { ImprintComponent } from './features/info/imprint.component';
import { LoginComponent } from './features/auth/login.component';
import { ProfileComponent } from './features/profile/profile.component';
import { UserManagementComponent } from './features/users/user-management.component';
import { AuditLogsComponent } from './features/logs/audit-logs.component';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { editorGuard } from './core/guards/editor.guard';
import { managerGuard } from './core/guards/manager.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: DashboardComponent },
  { path: 'schemas', loadComponent: () => import('./features/schema-overview/schema-overview.component').then((m) => m.SchemaOverviewComponent) },
  { path: 'schemas/new', loadComponent: () => import('./features/schema-create/schema-create.component').then((m) => m.SchemaCreateComponent), canActivate: [authGuard, managerGuard] },
  { path: 'entries/mine', component: MyEntriesComponent, canActivate: [authGuard] },
  { path: 'entries/:schemaKey/new', component: EntryCreateComponent, canActivate: [authGuard, editorGuard] },
  { path: 'entries/activities/timeline', component: ActivitiesTimelineComponent, canActivate: [authGuard] },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'entries/:schemaKey', component: EntryListComponent },
  { path: 'entries/:schemaKey/:id', component: EntryDetailComponent },
  { path: 'explorer', component: ApiExplorerComponent, canActivate: [authGuard, adminGuard] },
  { path: 'admin/users', component: UserManagementComponent, canActivate: [authGuard, adminGuard] },
  { path: 'admin/logs', component: AuditLogsComponent, canActivate: [authGuard, adminGuard] },
  { path: 'contact', component: ContactComponent },
  { path: 'imprint', component: ImprintComponent },
  { path: '**', redirectTo: '' }
];
