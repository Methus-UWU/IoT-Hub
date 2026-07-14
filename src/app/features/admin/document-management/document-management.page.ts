import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-document-management-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Document Management"
      description="Browse every document's owner, source, and storage size, with actions to view, re-sync, disable, or delete once this feature ships."
    />
  `
})
export class DocumentManagementPage {}
