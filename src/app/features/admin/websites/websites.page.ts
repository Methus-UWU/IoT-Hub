import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-websites-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Websites"
      description="Monitor domain and endpoint health with response time, SSL expiry, and 24h/7d uptime for every site, beyond the summary shown on Server Monitoring."
    />
  `
})
export class WebsitesPage {}
