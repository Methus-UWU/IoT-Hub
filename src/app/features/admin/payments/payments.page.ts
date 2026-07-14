import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-payments-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Payments"
      description="Billing is not live yet — this will list payment history and invoices once real payments are implemented."
      badge="Placeholder"
    />
  `
})
export class PaymentsPage {}
