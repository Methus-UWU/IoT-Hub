import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AiCatalog, AiChatRequest, AiChatResponse } from '../../../core/models/ai-assistant.model';
import { environment } from '../../../../environments/environment';

@Service()
export class AiAssistantService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}admin/ai`;

  getCatalog(): Observable<AiCatalog> {
    return this.http.get<AiCatalog>(`${this.endpoint}/catalog`);
  }

  chat(payload: AiChatRequest): Observable<AiChatResponse> {
    return this.http.post<AiChatResponse>(`${this.endpoint}/chat`, payload);
  }
}
