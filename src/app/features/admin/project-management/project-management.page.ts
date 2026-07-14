import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-project-management-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Project Management"
      description="Review every project's owner, plan, deploy status, and devices, with actions to view deployments or disable/delete a project once this feature ships."
    />
  `
})
export class ProjectManagementPage {}
