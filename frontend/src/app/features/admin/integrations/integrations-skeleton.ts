import { Component, input } from '@angular/core';

/** Mirrors each section while its own request is pending. */
@Component({
  selector: 'app-integrations-skeleton',
  templateUrl: './integrations-skeleton.html',
  styles: `
    :host {
      display: block;
    }
    .placeholder {
      border-radius: 0.5rem;
      background: var(--color-surface-muted);
    }
    .skeleton-card {
      border: 1px solid var(--color-border);
      border-radius: 1rem;
      padding: 1.5rem;
      background: var(--color-surface);
    }
  `,
  host: { 'aria-hidden': 'true' },
})
export class IntegrationsSkeleton {
  readonly section = input<'settings' | 'usage' | 'users'>('settings');
}
