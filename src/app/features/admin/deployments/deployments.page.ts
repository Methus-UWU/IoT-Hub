import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-deployments-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Deployments"
      description="Track deploy history per project — status, duration, and version — with actions to view logs, retry, or roll back once this feature ships."
    />
  `
})
export class DeploymentsPage {}
