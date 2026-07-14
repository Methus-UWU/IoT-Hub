import { Component, input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  template: `
    <div class="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
        <svg viewBox="0 0 24 24" fill="none" class="h-7 w-7">
          <path
            d="M4 7a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <h2 class="mt-4 text-lg font-semibold text-gray-900">{{ title() }}</h2>
      <p class="mt-1.5 max-w-sm text-sm text-gray-500">{{ description() }}</p>
      @if (badge()) {
        <span class="mt-4 inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
          {{ badge() }}
        </span>
      }
    </div>
  `
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly description = input<string>('');
  readonly badge = input<string>('Coming soon');
}
