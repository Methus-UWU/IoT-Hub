import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-quota-management-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Quota Management"
      description="Track each user's project, device, storage, AI, and deploy usage against their plan limits, with warnings when a quota is exceeded, once this feature ships."
    />
  `
})
export class QuotaManagementPage {}
