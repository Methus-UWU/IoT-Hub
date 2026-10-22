import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type CrudId = string | number;
export type CrudParams = Record<string, string | number | boolean>;

/**
 * Typed CRUD wrapper bound to a single resource path.
 * Use only for standard resources; special actions (login, deploy,
 * backup creation, restore, suspend) belong in explicit feature services.
 */
export class CrudResource<T, TCreate = Partial<T>> {
  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: string,
  ) {}

  list(params?: CrudParams): Observable<T[]> {
    return this.http.get<T[]>(this.baseUrl, { params: toHttpParams(params) });
  }

  get(id: CrudId): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}/${id}`);
  }

  create(payload: TCreate): Observable<T> {
    return this.http.post<T>(this.baseUrl, payload);
  }

  update(id: CrudId, payload: Partial<T>): Observable<T> {
    return this.http.put<T>(`${this.baseUrl}/${id}`, payload);
  }

  patch<TResult = T, TPatch = Partial<T>>(id: CrudId, payload: TPatch): Observable<TResult> {
    return this.http.patch<TResult>(`${this.baseUrl}/${id}`, payload);
  }

  delete(id: CrudId): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}

function toHttpParams(params?: CrudParams): HttpParams | undefined {
  if (!params) {
    return undefined;
  }

  return Object.entries(params).reduce(
    (httpParams, [key, value]) => httpParams.set(key, String(value)),
    new HttpParams(),
  );
}

@Service()
export class CrudService {
  private readonly http = inject(HttpClient);

  /** Creates a typed CRUD wrapper for a resource path, e.g. `resource<AdminUser>('admin/users')`. */
  resource<T, TCreate = Partial<T>>(path: string): CrudResource<T, TCreate> {
    return new CrudResource<T, TCreate>(this.http, `${environment.apiUrl}${path}`);
  }
}
