import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';

export type AdvisorMode = 'advice' | 'error';

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AdvisorReply {
  id: string;
  content: string;
  model: string;
  createdAt: string;
}

@Service()
export class IotAdvisorApiService {
  private readonly http = inject(HttpClient);

  chat(mode: AdvisorMode, messages: readonly AdvisorMessage[]): Observable<AdvisorReply> {
    return this.http.post<AdvisorReply>(`${environment.apiUrl}ai/advisor/chat`, {
      mode,
      messages,
    });
  }
}
