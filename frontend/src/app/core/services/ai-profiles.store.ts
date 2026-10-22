import { HttpClient } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';

export type AiProfileTier = 'auto' | 'balanced' | 'deep';
export type AiProfileScope = 'personal' | 'system';

export interface AiProfile {
  id: string;
  name: string;
  description: string;
  /** Null lets the server pick from the live catalog for `tier`. */
  model: string | null;
  tier: AiProfileTier;
  instructions: string;
  scope: AiProfileScope;
  /** Whether this user may change it. The server checks again on every write. */
  editable: boolean;
  updatedAt: string;
}

export interface AiProfileInput {
  name: string;
  description: string;
  model: string | null;
  tier: AiProfileTier;
  instructions: string;
}

/**
 * The user's AI profiles and the system ones, loaded once and shared by the account
 * settings and the IDE's assistant panel. Writes go to the server, which decides who
 * may change what; the list is then read back so both places show the same thing.
 */
@Service()
export class AiProfilesStore {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}ai/profiles`;
  private inflight: Promise<void> | null = null;

  readonly profiles = signal<AiProfile[]>([]);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly failed = signal(false);

  /** Loads the list once; `force` reads it again. Concurrent calls share one request. */
  load(force = false): Promise<void> {
    if (this.loaded() && !force) return Promise.resolve();
    this.inflight ??= this.fetch().finally(() => (this.inflight = null));
    return this.inflight;
  }

  async create(input: AiProfileInput, scope: AiProfileScope = 'personal'): Promise<AiProfile> {
    const created = await firstValueFrom(this.http.post<AiProfile>(this.url, { ...input, scope }));
    await this.load(true);
    return created;
  }

  async update(id: string, patch: Partial<AiProfileInput>): Promise<AiProfile> {
    const updated = await firstValueFrom(
      this.http.patch<AiProfile>(`${this.url}/${encodeURIComponent(id)}`, patch),
    );
    this.profiles.update((list) => list.map((profile) => (profile.id === id ? updated : profile)));
    return updated;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`));
    this.profiles.update((list) => list.filter((profile) => profile.id !== id));
  }

  byId(id: string | null): AiProfile | undefined {
    return id ? this.profiles().find((profile) => profile.id === id) : undefined;
  }

  /** Another account signs in next: nothing of this one may show. */
  reset(): void {
    this.profiles.set([]);
    this.loaded.set(false);
    this.failed.set(false);
  }

  private async fetch(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.profiles.set(await firstValueFrom(this.http.get<AiProfile[]>(this.url)));
      this.loaded.set(true);
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
