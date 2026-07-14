import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-permissions-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Permissions"
      description="Manage roles — Super Admin, Admin, Support, Billing Admin, User — and fine-grained permissions such as USER_SUSPEND or BACKUP_RESTORE, once this feature ships."
    />
  `
})
export class PermissionsPage {}
