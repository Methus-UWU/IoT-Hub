import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-subscriptions-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Subscriptions"
      description="Billing is not live yet — this will list active subscriptions once real payments are implemented."
      badge="Placeholder"
    />
  `
})
export class SubscriptionsPage {}
