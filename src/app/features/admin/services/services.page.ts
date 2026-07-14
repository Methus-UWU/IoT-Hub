import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-services-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Services"
      description="Detailed status for every platform service — Angular Web, NestJS API, Supabase, Redis, MQTT Broker, WebSocket Gateway, AI Service, and background workers — beyond the summary shown on Server Monitoring."
    />
  `
})
export class ServicesPage {}
