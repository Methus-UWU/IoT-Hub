import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-database-backup-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Database Backups"
      description="Trigger new backups, review backup history, and download or restore past backups once this feature ships."
    />
  `
})
export class DatabaseBackupPage {}
