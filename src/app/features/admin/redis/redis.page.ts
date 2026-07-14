import { Component } from '@angular/core';

import { EmptyState } from '../../../shared/components/empty-state/empty-state';

@Component({
  selector: 'app-redis-page',
  imports: [EmptyState],
  template: `
    <app-empty-state
      title="Redis"
      description="Review memory usage, connected clients, cache hit rate, and queue status, with actions to clear the cache or retry failed jobs (behind a confirmation dialog), once this feature ships."
    />
  `
})
export class RedisPage {}
