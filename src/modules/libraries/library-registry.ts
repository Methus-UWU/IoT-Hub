import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { MAX_ARCHIVE_BYTES } from './library-archive';

/**
 * The PlatformIO library registry, read-only and unauthenticated.
 *
 * The API reaches exactly two hosts here: the registry API for metadata and the
 * registry download host for archives. Every URL it fetches is built from those
 * constants or, for downloads, checked against them — a registry response cannot
 * point the API at another host (SSRF), and redirects are followed by hand under
 * the same rule. Downloads are size-capped while streaming and must match the
 * SHA-256 the registry published.
 */
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

export interface LibraryRelease {
  owner: string;
  name: string;
  version: string;
  frameworks: string[];
  downloadUrl: string;
  sha256: string;
  size: number;
}

/** Registry orderings: `updated` and `trending` surface new libraries. */
export const LIBRARY_SORTS = [
  'popularity',
  'trending',
  'updated',
  'relevance',
] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export interface LibrarySearchOptions {
  platform?: string;
  sort?: LibrarySort;
}

export interface LibrarySearchPage {
  total: number;
  page: number;
  items: LibrarySummary[];
}

export class LibraryRegistryError extends Error {
  constructor(
    readonly reason: 'not_found' | 'unavailable' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

/** The seam the service depends on, so tests never reach the network. */
export abstract class LibraryRegistry {
  abstract search(
    query: string,
    page: number,
    options?: LibrarySearchOptions,
  ): Promise<LibrarySearchPage>;

  abstract details(owner: string, name: string): Promise<LibraryDetails>;

  /** One version's archive location; the latest when `version` is omitted. */
  abstract release(
    owner: string,
    name: string,
    version?: string,
  ): Promise<LibraryRelease>;

  /** An owner for a dependency that names only the library. */
  abstract findByName(name: string): Promise<LibrarySummary | null>;

  /** The archive bytes, verified against the published checksum. */
  abstract download(release: LibraryRelease): Promise<Buffer>;
}

const REGISTRY_API = 'https://api.registry.platformio.org';
const DOWNLOAD_HOST_SUFFIX = '.platformio.org';
const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const PAGE_SIZE = 20;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_ENTRIES = 300;

@Injectable()
export class PlatformioRegistryClient extends LibraryRegistry {
  private readonly logger = new Logger(PlatformioRegistryClient.name);
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  async search(
    query: string,
    page: number,
    options: LibrarySearchOptions = {},
  ): Promise<LibrarySearchPage> {
    const terms = ['type:library', 'framework:arduino'];
    if (options.platform) terms.push(`platform:${options.platform}`);
    if (query) terms.push(query);
    const url = new URL('/v3/search', REGISTRY_API);
    url.searchParams.set('query', terms.join(' '));
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('sort', options.sort ?? 'popularity');
    const body = record(await this.json(url));
    return {
      total: number(body['total']) ?? 0,
      page,
      items: array(body['items']).flatMap((item) => {
        const summary = toSummary(item);
        return summary ? [summary] : [];
      }),
    };
  }

  async details(owner: string, name: string): Promise<LibraryDetails> {
    const body = await this.packageJson(owner, name);
    const summary = toSummary(body);
    if (!summary) {
      throw new LibraryRegistryError('invalid', 'The registry answered oddly.');
    }
    return {
      ...summary,
      versions: array(body['versions']).flatMap((raw) => {
        const version = record(raw);
        const versionName = string(version['name']);
        return versionName
          ? [{ name: versionName, releasedAt: string(version['released_at']) }]
          : [];
      }),
      headers: strings(body['headers']).slice(0, 50),
      frameworks: strings(body['frameworks']),
      platforms: strings(body['platforms']),
      license: string(body['license']),
      repositoryUrl: httpsUrl(body['repository_url']),
      homepage: httpsUrl(body['homepage']),
    };
  }

  async release(
    owner: string,
    name: string,
    version?: string,
  ): Promise<LibraryRelease> {
    const body = await this.packageJson(owner, name);
    const versions = array(body['versions']).map(record);
    const chosen = version
      ? versions.find((entry) => entry['name'] === version)
      : record(body['version']);
    if (!chosen || !string(chosen['name'])) {
      throw new LibraryRegistryError(
        'not_found',
        `Version ${version ?? 'latest'} of ${owner}/${name} was not found.`,
      );
    }
    // A library publishes one archive for every system (`*`).
    const file = array(chosen['files'])
      .map(record)
      .find(
        (entry) => entry['system'] === '*' || entry['system'] === undefined,
      );
    const downloadUrl = string(file?.['download_url']);
    const sha256 = string(record(file?.['checksum'])['sha256']);
    if (!file || !downloadUrl || !sha256 || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new LibraryRegistryError(
        'invalid',
        `${owner}/${name} has no archive this platform can install.`,
      );
    }
    return {
      owner: string(record(body['owner'])['username']) ?? owner,
      name: string(body['name']) ?? name,
      version: string(chosen['name']) ?? '',
      frameworks: strings(body['frameworks']),
      downloadUrl,
      sha256,
      size: number(file['size']) ?? 0,
    };
  }

  async findByName(name: string): Promise<LibrarySummary | null> {
    const url = new URL('/v3/search', REGISTRY_API);
    url.searchParams.set(
      'query',
      `type:library framework:arduino name:"${name.replaceAll('"', '')}"`,
    );
    url.searchParams.set('limit', '5');
    const items = array(record(await this.json(url))['items']).flatMap(
      (item) => {
        const summary = toSummary(item);
        return summary ? [summary] : [];
      },
    );
    return (
      items.find((item) => item.name.toLowerCase() === name.toLowerCase()) ??
      null
    );
  }

  async download(release: LibraryRelease): Promise<Buffer> {
    if (release.size > MAX_ARCHIVE_BYTES) {
      throw new LibraryRegistryError(
        'invalid',
        `${release.name} is too large to add to a project.`,
      );
    }
    let url = allowedDownloadUrl(release.downloadUrl);
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.fetch(url, signal);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) break;
        url = allowedDownloadUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new LibraryRegistryError(
          'unavailable',
          'The library download failed. Try again later.',
        );
      }
      const archive = await readLimited(response, MAX_ARCHIVE_BYTES);
      const digest = createHash('sha256').update(archive).digest('hex');
      if (digest !== release.sha256) {
        throw new LibraryRegistryError(
          'invalid',
          'The downloaded library does not match its published checksum.',
        );
      }
      return archive;
    }
    throw new LibraryRegistryError(
      'unavailable',
      'The library download failed.',
    );
  }

  private packageJson(
    owner: string,
    name: string,
  ): Promise<Record<string, unknown>> {
    const url = new URL(
      `/v3/packages/${encodeURIComponent(owner)}/library/${encodeURIComponent(name)}`,
      REGISTRY_API,
    );
    return this.json(url).then(record);
  }

  /** Registry metadata, cached briefly so browsing does not hammer the registry. */
  private async json(url: URL): Promise<unknown> {
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const response = await this.fetch(
      url,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    );
    if (response.status === 404) {
      await response.body?.cancel();
      throw new LibraryRegistryError(
        'not_found',
        'That library is not in the registry.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new LibraryRegistryError(
        'unavailable',
        'The library registry is not answering. Try again later.',
      );
    }
    const value: unknown = JSON.parse(
      (await readLimited(response, 2 * 1024 * 1024)).toString('utf8'),
    );
    if (this.cache.size >= CACHE_ENTRIES) {
      // Maps keep insertion order: the first key is the oldest entry.
      const [oldest] = this.cache.keys();
      this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async fetch(url: URL, signal: AbortSignal): Promise<Response> {
    try {
      return await fetch(url, {
        headers: { Accept: 'application/json, application/gzip' },
        redirect: 'manual',
        signal,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Registry request to ${url.host} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new LibraryRegistryError(
        'unavailable',
        'The library registry is not answering. Try again later.',
      );
    }
  }
}

function allowedDownloadUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LibraryRegistryError(
      'invalid',
      'The registry gave a bad download link.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !url.hostname.endsWith(DOWNLOAD_HOST_SUFFIX)
  ) {
    throw new LibraryRegistryError(
      'invalid',
      'The registry pointed the download somewhere it may not go.',
    );
  }
  return url;
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) {
    await response.body?.cancel();
    throw new LibraryRegistryError(
      'invalid',
      'The registry response is too large.',
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new LibraryRegistryError(
        'invalid',
        'The registry response is too large.',
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function toSummary(raw: unknown): LibrarySummary | null {
  const body = record(raw);
  const owner = string(record(body['owner'])['username']);
  const name = string(body['name']);
  if (!owner || !name) return null;
  const version = record(body['version']);
  return {
    owner,
    name,
    description: (string(body['description']) ?? '').slice(0, 500),
    version: string(version['name']) ?? '',
    releasedAt: string(version['released_at']),
    updatedAt: string(body['updated_at']),
    popularityRank: number(body['popularity_rank']),
    stars: number(body['stars_count']) ?? 0,
    keywords: strings(body['keywords']).slice(0, 10),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strings(value: unknown): string[] {
  return array(value).filter(
    (entry): entry is string => typeof entry === 'string',
  );
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Links shown to users: https only, so a registry entry cannot inject `javascript:`. */
function httpsUrl(value: unknown): string | null {
  const text = string(value);
  if (!text) return null;
  try {
    const url = new URL(text.replace(/\.git$/, ''));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
