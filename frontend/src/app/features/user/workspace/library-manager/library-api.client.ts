import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { WorkspaceContextService } from '../../../../core/services/workspace-context.service';
import { environment } from '../../../../../environments/environment';

export type LibrarySort = 'popularity' | 'trending' | 'updated' | 'relevance';
export type LibraryPlatform = 'espressif32' | 'atmelavr';

export interface LibrarySummary {
  owner: string;
  name: string;
  description: string;
  version: string;
  releasedAt: string | null;
  updatedAt: string | null;
  popularityRank: number | null;
  stars: number;
  keywords: string[];
}

export interface LibraryDetails extends LibrarySummary {
  versions: { name: string; releasedAt: string | null }[];
  headers: string[];
  frameworks: string[];
  platforms: string[];
  license: string | null;
  repositoryUrl: string | null;
  homepage: string | null;
}

export interface LibrarySearchPage {
  total: number;
  page: number;
  items: LibrarySummary[];
}

export interface InstalledLibrary {
  folder: string;
  owner: string;
  name: string;
  version: string;
  installedAt: string;
  fileCount: number;
  sizeBytes: number;
}

export interface InstallOutcome {
  installed: { folder: string; owner: string; name: string; version: string }[];
  skipped: { name: string; reason: string }[];
}

/**
 * The Library Manager API: the PlatformIO registry through the server, and the
 * libraries installed in one project. The server downloads, checks, and unpacks every
 * archive; the browser never fetches from the registry itself.
 */
@Service()
export class LibraryApiClient {
  private readonly http = inject(HttpClient);
  private readonly workspaces = inject(WorkspaceContextService);

  search(
    query: string,
    options: { page?: number; sort?: LibrarySort; platform?: LibraryPlatform } = {},
  ): Promise<LibrarySearchPage> {
    let params = new HttpParams().set('q', query).set('sort', options.sort ?? 'popularity');
    if (options.page) params = params.set('page', options.page);
    if (options.platform) params = params.set('platform', options.platform);
    return firstValueFrom(
      this.http.get<LibrarySearchPage>(`${environment.apiUrl}libraries/search`, { params }),
    );
  }

  details(owner: string, name: string): Promise<LibraryDetails> {
    const params = new HttpParams().set('owner', owner).set('name', name);
    return firstValueFrom(
      this.http.get<LibraryDetails>(`${environment.apiUrl}libraries/package`, { params }),
    );
  }

  async installed(projectId: string): Promise<InstalledLibrary[]> {
    return firstValueFrom(this.http.get<InstalledLibrary[]>(await this.librariesUrl(projectId)));
  }

  async install(
    projectId: string,
    library: { owner: string; name: string; version?: string },
  ): Promise<InstallOutcome> {
    return firstValueFrom(
      this.http.post<InstallOutcome>(await this.librariesUrl(projectId), library),
    );
  }

  async remove(projectId: string, folder: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${await this.librariesUrl(projectId)}/${encodeURIComponent(folder)}`),
    );
  }

  private async librariesUrl(projectId: string): Promise<string> {
    const workspace = await firstValueFrom(this.workspaces.ensureLoaded());
    if (!workspace) throw new Error('No workspace is available for this account');
    return `${environment.apiUrl}workspaces/${encodeURIComponent(
      workspace.id,
    )}/projects/${encodeURIComponent(projectId)}/libraries`;
  }
}
