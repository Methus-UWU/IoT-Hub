import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-database-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Database"
      description="Inspect Supabase connection status, database size, active connections, slow queries, migrations, and RLS status, with actions to run a health check or create a backup, once this feature ships."
    />
  `
})
export class DatabasePage {}
