import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
}

@Service()
export class AuthService {
  private readonly http = inject(HttpClient);

  register(payload: RegisterPayload): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}auth/register`, payload);
  }
}
