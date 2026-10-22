import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

/** Reachable without a session; a 401 here is an answer, not an expired token. */
const PUBLIC_API_PATHS = ['auth/availability'];

/**
 * Attaches the Supabase access token to API calls and retries once on a 401.
 *
 * Supabase refreshes the token in the background, so a 401 normally means the
 * client's copy is stale rather than that the user is signed out. One forced
 * refresh distinguishes the two: if it fails, the session is genuinely gone.
 *
 * Only requests to our own API get the token — sending it elsewhere would leak it.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiUrl)) {
    return next(request);
  }

  const auth = inject(AuthService);
  const router = inject(Router);
  const accessToken = auth.getAccessToken();

  const authenticatedRequest = request.clone({
    setHeaders: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  return next(authenticatedRequest).pipe(
    catchError((error: unknown) => {
      const path = request.url.slice(environment.apiUrl.length).split('?')[0];

      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        PUBLIC_API_PATHS.includes(path) ||
        !accessToken
      ) {
        return throwError(() => error);
      }

      return auth.refreshAccessToken().pipe(
        switchMap((refreshedToken) =>
          next(
            request.clone({
              setHeaders: { Authorization: `Bearer ${refreshedToken}` },
            }),
          ),
        ),
        catchError((refreshError: unknown) => {
          // Supabase could not be reached, so nothing is known about the session.
          // Signing the user out over a dropped connection is what made sessions
          // appear to expire at random; the request fails and the session stays.
          if (isAuthRetryableFetchError(refreshError)) {
            return throwError(() => error);
          }
          auth.clearSession();
          // A route guard can be the caller. Starting a navigation from here
          // cancels the one that issued the request, and because the target is
          // /auth/login it would cancel itself on every retry — the link looks
          // dead. Anywhere under /auth the page already handles a failed
          // session, so leave the routing to it.
          if (!headingToAuth(router)) {
            void router.navigate(['/auth/login']);
          }
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};

/** Where the router is going, or where it already is when nothing is in flight. */
function headingToAuth(router: Router): boolean {
  const navigation = router.getCurrentNavigation();
  const target = navigation
    ? (navigation.finalUrl ?? navigation.extractedUrl).toString()
    : router.url;
  return target.startsWith('/auth');
}
