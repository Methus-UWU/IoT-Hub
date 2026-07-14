import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-api-keys-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="API Keys"
      description="Create, rotate, and revoke API keys for devices and integrations, with scope and last-used tracking, once this feature ships."
    />
  `
})
export class ApiKeysPage {}
