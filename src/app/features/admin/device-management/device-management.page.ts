import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-device-management-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Device Management"
      description="Inspect connected IoT devices, review telemetry, and manage device access from a single view once this feature ships."
    />
  `
})
export class DeviceManagementPage {}
