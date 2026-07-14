import { Component, input } from '@angular/core';

export type MetricIconKind = 'cpu' | 'memory' | 'disk' | 'network';

@Component({
  selector: 'app-metric-icon',
  template: `
    @switch (kind()) {
      @case ('cpu') {
        <svg viewBox="0 0 24 24" fill="none" class="h-full w-full">
          <rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.6" />
          <rect x="10" y="10" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1.4" />
          <path
            d="M9 3v2M12 3v2M15 3v2M9 19v2M12 19v2M15 19v2M3 9h2M3 12h2M3 15h2M19 9h2M19 12h2M19 15h2"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
      }
      @case ('memory') {
        <svg viewBox="0 0 24 24" fill="none" class="h-full w-full">
          <rect x="4" y="6" width="16" height="12" rx="1.5" stroke="currentColor" stroke-width="1.6" />
          <path d="M8 6v12M12 6v12M16 6v12" stroke="currentColor" stroke-width="1.4" />
        </svg>
      }
      @case ('disk') {
        <svg viewBox="0 0 24 24" fill="none" class="h-full w-full">
          <ellipse cx="12" cy="6.5" rx="8" ry="3" stroke="currentColor" stroke-width="1.6" />
          <path
            d="M4 6.5v11c0 1.66 3.58 3 8 3s8-1.34 8-3v-11"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" stroke="currentColor" stroke-width="1.6" />
        </svg>
      }
      @case ('network') {
        <svg viewBox="0 0 24 24" fill="none" class="h-full w-full">
          <path
            d="M4 8.5a12 12 0 0 1 16 0M7 12a7.5 7.5 0 0 1 10 0"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <circle cx="12" cy="17" r="1.6" fill="currentColor" />
        </svg>
      }
    }
  `
})
export class MetricIcon {
  readonly kind = input.required<MetricIconKind>();
}
