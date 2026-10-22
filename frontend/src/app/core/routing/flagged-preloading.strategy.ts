import { Service } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of } from 'rxjs';

/**
 * Preloads only the lazy routes marked `data: { preload: true }`.
 *
 * The project pages — IDE, canvas, dashboard — are switched between constantly, so
 * their code is fetched in the background once the app is idle and the first switch
 * does not wait on a chunk download. Everything else stays on demand; preloading
 * the admin console for every user would be wasted bandwidth.
 */
@Service()
export class FlaggedPreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    return route.data?.['preload'] === true ? load() : of(null);
  }
}
