import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { catchError, map, of, retry, switchMap, throwError, timer } from 'rxjs';

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
        // An API that is restarting or briefly unreachable is not a signed-out
        // user. Retry a few times before deciding anything.
        retry({
          count: PROFILE_RETRIES,
          delay: (error: unknown, attempt: number) =>
            isSignedOut(error) ? throwError(() => error) : timer(attempt * 1000),
        }),
        map((user) => {
          const isAdmin = user.role.name.toLowerCase() === 'admin';
          if (isAdmin === expectAdmin) return true;
          return router.createUrlTree([isAdmin ? '/admin' : '/user/projects']);
        }),
      );
    }),
    catchError((error: unknown) => {
      if (isSignedOut(error)) {
        auth.clearSession();
        return of(router.createUrlTree(['/auth/login']));
      }
      // The session is intact but the role could not be read. Guards are UX only
      // and every call is authorized again by the API, so let a user through to
      // pages that will show their own load errors rather than to the login
      // screen. The admin console is not shown on a guess.
      return of(expectAdmin ? router.createUrlTree(['/user/projects']) : true);
    }),
  );
}

/** Attempts after the first before the profile lookup is given up on. */
const PROFILE_RETRIES = 3;

/** Only the API saying the token is not accepted means the user is signed out. */
function isSignedOut(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}
