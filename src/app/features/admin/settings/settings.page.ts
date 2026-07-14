import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-settings-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Settings"
      description="Configure General, Security, AI, Quota, Backup, Deploy, Notification, SMTP, MQTT, Redis, and Supabase settings once this feature ships."
    />
  `
})
export class SettingsPage {}
