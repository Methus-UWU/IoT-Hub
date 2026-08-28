import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';

import { AuthService } from '../services/auth.service';

/**
 * Route guards are UX only.
 *
 * They decide which screen to show, never whether an action is permitted. Every
 * protected operation is authorized again by NestJS against the database, so a user
 * who forces their way to a route still cannot do anything there.
 */

function requireSession() {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.restoreSession().pipe(
    map((session) =>
      session ? true : router.createUrlTree(['/auth/login']),
    ),
    catchError(() => of(router.createUrlTree(['/auth/login']))),
  );
}

export const authGuard: CanActivateFn = () => requireSession();
export const authMatchGuard: CanMatchFn = () => requireSession();

function homeFor(roleName: string): string {
  return roleName.toLowerCase() === 'admin' ? '/admin' : '/user/projects';
}

/** Sends an already-signed-in visitor away from the login and sign-up screens. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const known = auth.currentUser();
  if (known) return router.createUrlTree([homeFor(known.role.name)]);

  return auth.restoreSession().pipe(
    switchMap((session) => {
      if (!session) return of(true);
      return auth
        .getCurrentUser()
        .pipe(map((user) => router.createUrlTree([homeFor(user.role.name)])));
    }),
    catchError(() => {
      auth.clearSession();
      return of(true);
    }),
  );
};

export const adminRoleGuard: CanActivateFn = () => requireRole(true);
export const userRoleGuard: CanActivateFn = () => requireRole(false);

function requireRole(expectAdmin: boolean) {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.restoreSession().pipe(
    switchMap((session) => {
      if (!session) return of(router.createUrlTree(['/auth/login']));

      return auth.getCurrentUser().pipe(
        map((user) => {
          const isAdmin = user.role.name.toLowerCase() === 'admin';
          if (isAdmin === expectAdmin) return true;
          return router.createUrlTree([isAdmin ? '/admin' : '/user/projects']);
        }),
      );
    }),
    catchError(() => {
      auth.clearSession();
      return of(router.createUrlTree(['/auth/login']));
    }),
  );
}
