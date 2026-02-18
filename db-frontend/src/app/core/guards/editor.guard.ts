import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const editorGuard: CanActivateFn = (_route, state): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated() && auth.canEditEntries()) {
    return true;
  }

  if (!auth.isAuthenticated()) {
    if (state.url) {
      auth.setRedirectUrl(state.url);
    }
    return router.createUrlTree(['/login']);
  }

  return router.createUrlTree(['/']);
};

