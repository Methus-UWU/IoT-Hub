import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-usage-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Usage"
      description="Billing is not live yet — this will summarize per-plan usage against billed quotas once real payments are implemented."
      badge="Placeholder"
    />
  `
})
export class UsagePage {}
