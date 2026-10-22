import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { DatabaseOverview } from '../../../core/models/admin.model';
import { environment } from '../../../../environments/environment';

@Service()
export class DatabaseService {
  private readonly http = inject(HttpClient);

  getOverview(): Observable<DatabaseOverview> {
    return this.http.get<DatabaseOverview>(`${environment.apiUrl}admin/database/overview`);
  }
}
