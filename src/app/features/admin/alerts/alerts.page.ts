import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-alerts-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Alerts"
      description="See open, acknowledged, and resolved alerts for CPU, memory, disk, API, database, Redis, MQTT, backup, deploy, and AI failures, once this feature ships."
    />
  `
})
export class AlertsPage {}
