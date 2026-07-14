import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-user-management-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="User Management"
      description="Search users, change plans, view quota, and suspend or activate accounts from here once this feature ships."
    />
  `
})
export class UserManagementPage {}
