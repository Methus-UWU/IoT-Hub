import { Component, input } from '@angular/core';

/** Mirrors a post's vote rail, author, title, body, and actions while data loads. */
@Component({
  selector: 'app-community-post-skeleton',
  host: { 'aria-hidden': 'true', class: 'block' },
  template: `
    <div class="grid grid-cols-[2.5rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div class="flex flex-col items-center gap-3 bg-neutral-50 py-4">
        <span class="h-3 w-3 rounded bg-neutral-200"></span>
        <span class="h-4 w-4 rounded bg-neutral-200"></span>
        <span class="h-3 w-3 rounded bg-neutral-200"></span>
      </div>
      <div class="space-y-3 p-4">
        <div class="flex items-center gap-2">
          <span class="size-5 rounded-full bg-neutral-200"></span>
          <span class="h-2.5 w-24 rounded bg-neutral-200"></span>
          <span class="h-2.5 w-16 rounded bg-neutral-100"></span>
        </div>
        <div class="h-4 w-3/4 rounded bg-neutral-200"></div>
        <div class="space-y-2">
          @for (line of lines; track line) {
            <div class="h-2.5 rounded bg-neutral-100" [style.width.%]="line === 2 ? 67 : 100"></div>
          }
        </div>
        @if (expanded()) {
          <div class="h-24 rounded border border-neutral-100 bg-neutral-50"></div>
          <div class="h-2.5 w-4/5 rounded bg-neutral-100"></div>
        }
        <div class="flex gap-3 pt-1">
          <span class="h-3 w-16 rounded bg-neutral-200"></span>
          <span class="h-3 w-12 rounded bg-neutral-100"></span>
        </div>
      </div>
    </div>
  `,
})
export class CommunityPostSkeleton {
  readonly expanded = input(false);
  protected readonly lines = [0, 1, 2];
}
