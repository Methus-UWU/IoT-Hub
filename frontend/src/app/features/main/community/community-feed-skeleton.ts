import { Component } from '@angular/core';
import { CommunityPostSkeleton } from './community-post-skeleton';

/** Reserves the complete feed layout while the first page is being fetched. */
@Component({
  selector: 'app-community-feed-skeleton',
  imports: [CommunityPostSkeleton],
  host: { role: 'status', 'aria-label': 'กำลังโหลดชุมชน', 'aria-busy': 'true' },
  template: `
    <div class="grid items-start gap-6 min-[64rem]:grid-cols-[minmax(0,40rem)_19rem]">
      <div class="min-w-0 space-y-3">
        <div class="composer-skeleton flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3" aria-hidden="true">
          <div class="size-8 shrink-0 rounded-full bg-neutral-200"></div>
          <div class="h-3 w-16 rounded bg-neutral-200"></div>
          <div class="h-10 flex-1 rounded bg-neutral-100"></div>
        </div>
        <div class="sort-skeleton flex justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4" aria-hidden="true">
          <div class="h-5 w-1/2 rounded bg-neutral-200"></div>
          <div class="h-5 w-1/3 rounded-full bg-neutral-100"></div>
        </div>
        <div class="feed-list space-y-3" aria-busy="true">
          @for (row of rows; track row) { <app-community-post-skeleton /> }
        </div>
      </div>
      <div class="space-y-3" aria-hidden="true">
        <div class="about-skeleton space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
          <div class="h-3 w-28 rounded bg-neutral-200"></div>
          <div class="space-y-2">
            <div class="h-3 rounded bg-neutral-100"></div>
            <div class="h-3 rounded bg-neutral-100"></div>
            <div class="h-3 w-2/3 rounded bg-neutral-100"></div>
          </div>
          <div class="h-10 rounded-full bg-neutral-200"></div>
        </div>
        <div class="side-tags space-y-5 rounded-lg border border-neutral-200 bg-white p-4">
          <div class="h-3 w-16 rounded bg-neutral-200"></div>
          <div class="space-y-5" aria-busy="true">
            @for (row of rows; track row) {
              <div class="flex justify-between gap-4">
                <div class="h-3 w-24 rounded bg-neutral-100"></div>
                <div class="h-3 w-4 rounded bg-neutral-100"></div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CommunityFeedSkeleton {
  protected readonly rows = [0, 1, 2, 3, 4];
}
