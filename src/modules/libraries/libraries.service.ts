import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ProjectFilesService } from '../projects/project-files.service';
import {
  LibraryArchiveError,
  LibraryFile,
  extractLibrary,
} from './library-archive';
import {
  LIBRARY_MARKER,
  LibraryMarker,
  libraryDependencies,
  libraryFolderName,
  parseMarker,
} from './library-manifest';
import {
  LibraryRegistry,
  LibraryRegistryError,
  LibraryRelease,
  LibrarySearchOptions,
} from './library-registry';

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
  /** Dependencies left out, and why; the requested library is never in here. */
  skipped: { name: string; reason: string }[];
}

/** The requested library plus its dependencies, in one install. */
export const MAX_LIBRARIES_PER_INSTALL = 6;

const FOLDER = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MARKER_PATH = new RegExp(
  `^lib/([^/]+)/${LIBRARY_MARKER.replace('.', '\\.')}$`,
);

interface Wanted {
  owner?: string;
  name: string;
  version?: string;
  requested: boolean;
}

interface Planned {
  release: LibraryRelease;
  folder: string;
  files: LibraryFile[];
}

/**
 * The Library Manager: browse the PlatformIO registry and install its libraries as
 * project files.
 *
 * A library lands in `lib/<Folder>/`, where PlatformIO and the Arduino builder both
 * look, so the isolated builder compiles it with no network and no image rebuild
 * (ADR-006). The folder holds a marker naming the registry package; that marker is
 * the only record of what is installed.
 *
 * Authorization is the controller's; this assumes the caller may write the project.
 */
@Injectable()
export class LibrariesService {
  constructor(
    private readonly registry: LibraryRegistry,
    private readonly files: ProjectFilesService,
  ) {}

  async search(query: string, page: number, options: LibrarySearchOptions) {
    try {
      return await this.registry.search(query, page, options);
    } catch (error: unknown) {
      throw toHttpError(error);
    }
  }

  async details(owner: string, name: string) {
    try {
      return await this.registry.details(owner, name);
    } catch (error: unknown) {
      throw toHttpError(error);
    }
  }

  async list(projectId: string): Promise<InstalledLibrary[]> {
    const summaries = await this.files.list(projectId);
    const totals = new Map<string, { count: number; bytes: number }>();
    for (const file of summaries) {
      const folder = /^lib\/([^/]+)\//.exec(file.path)?.[1];
      if (!folder) continue;
      const total = totals.get(folder) ?? { count: 0, bytes: 0 };
      total.count++;
      total.bytes += file.sizeBytes;
      totals.set(folder, total);
    }

    const markers = summaries.flatMap((file) => {
      const folder = MARKER_PATH.exec(file.path)?.[1];
      return folder ? [folder] : [];
    });
    const libraries = await Promise.all(
      markers.map(async (folder) => {
        const file = await this.files.read(
          projectId,
          `lib/${folder}/${LIBRARY_MARKER}`,
        );
        const marker = parseMarker(file.content);
        if (!marker) return null;
        const total = totals.get(folder) ?? { count: 0, bytes: 0 };
        return {
          folder,
          owner: marker.owner,
          name: marker.name,
          version: marker.version,
          installedAt: marker.installedAt,
          fileCount: total.count,
          sizeBytes: total.bytes,
        };
      }),
    );
    return libraries
      .filter((library): library is InstalledLibrary => library !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Installs a library, or replaces the installed copy with another version, and
   * adds the dependencies its manifest names that the project does not have yet.
   * Every folder is written in one transaction.
   */
  async install(
    projectId: string,
    request: { owner: string; name: string; version?: string },
  ): Promise<InstallOutcome> {
    const installed = await this.list(projectId);
    const takenFolders = new Set(
      (await this.files.list(projectId)).flatMap((file) => {
        const folder = /^lib\/([^/]+)\//.exec(file.path)?.[1];
        return folder ? [folder.toLowerCase()] : [];
      }),
    );

    const queue: Wanted[] = [{ ...request, requested: true }];
    const planned: Planned[] = [];
    const skipped: InstallOutcome['skipped'] = [];
    const isPlanned = (name: string) =>
      planned.some((entry) => same(entry.release.name, name));

    for (let wanted = queue.shift(); wanted; wanted = queue.shift()) {
      if (!wanted.requested) {
        if (isPlanned(wanted.name)) continue;
        if (installed.some((library) => same(library.name, wanted.name)))
          continue;
        if (planned.length >= MAX_LIBRARIES_PER_INSTALL) {
          skipped.push({
            name: wanted.name,
            reason: 'Too many dependencies for one install; add it separately.',
          });
          continue;
        }
      }

      try {
        const next = await this.prepare(wanted, installed, takenFolders);
        if (!next) {
          skipped.push({
            name: wanted.name,
            reason: 'Not found in the registry.',
          });
          continue;
        }
        if (isPlanned(next.release.name)) continue;
        planned.push(next);
        for (const dependency of libraryDependencies(next.files)) {
          queue.push({ ...dependency, requested: false });
        }
      } catch (error: unknown) {
        if (wanted.requested) throw toHttpError(error);
        skipped.push({ name: wanted.name, reason: reasonOf(error) });
      }
    }

    const installedAt = new Date().toISOString();
    await this.files.replaceFolders(
      projectId,
      planned.map((entry) => `lib/${entry.folder}`),
      planned.flatMap((entry) => [
        ...entry.files.map((file) => ({
          path: `lib/${entry.folder}/${file.path}`,
          content: file.content,
        })),
        {
          path: `lib/${entry.folder}/${LIBRARY_MARKER}`,
          content: `${JSON.stringify(
            {
              owner: entry.release.owner,
              name: entry.release.name,
              version: entry.release.version,
              sha256: entry.release.sha256,
              installedAt,
            } satisfies LibraryMarker,
            null,
            2,
          )}\n`,
        },
      ]),
    );

    return {
      installed: planned.map((entry) => ({
        folder: entry.folder,
        owner: entry.release.owner,
        name: entry.release.name,
        version: entry.release.version,
      })),
      skipped,
    };
  }

  /** Removes a library the manager installed. The user's own `lib/` folders stay. */
  async remove(
    projectId: string,
    folder: string,
  ): Promise<{ removed: number }> {
    if (!FOLDER.test(folder)) {
      throw new BadRequestException({
        code: 'INVALID_LIBRARY_FOLDER',
        message: 'That is not a library folder name',
      });
    }
    const installed = await this.list(projectId);
    if (!installed.some((library) => library.folder === folder)) {
      throw new NotFoundException({
        code: 'LIBRARY_NOT_INSTALLED',
        message: 'That library is not installed by the Library Manager',
      });
    }
    return {
      removed: await this.files.deleteFolder(projectId, `lib/${folder}`),
    };
  }

  /** Resolves, downloads, and unpacks one library; null when no owner is found. */
  private async prepare(
    wanted: Wanted,
    installed: InstalledLibrary[],
    takenFolders: Set<string>,
  ): Promise<Planned | null> {
    const owner =
      wanted.owner ?? (await this.registry.findByName(wanted.name))?.owner;
    if (!owner) return null;

    const release = await this.registry.release(
      owner,
      wanted.name,
      wanted.version,
    );
    if (
      release.frameworks.length &&
      !release.frameworks.some(
        (framework) => framework === 'arduino' || framework === '*',
      )
    ) {
      throw new UnprocessableEntityException({
        code: 'LIBRARY_NOT_ARDUINO',
        message: `${release.name} is not an Arduino library`,
      });
    }

    const folder = libraryFolderName(release.name);
    const current = installed.find((library) => library.folder === folder);
    const ownFolder = takenFolders.has(folder.toLowerCase()) && !current;
    if (ownFolder || (current && !same(current.name, release.name))) {
      throw new ConflictException({
        code: 'LIBRARY_FOLDER_TAKEN',
        message: `lib/${folder} already holds other code. Rename or delete it first.`,
      });
    }

    const archive = await this.registry.download(release);
    const { files } = await extractLibrary(archive);
    return { release, folder, files };
  }
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function reasonOf(error: unknown): string {
  if (
    error instanceof LibraryRegistryError ||
    error instanceof LibraryArchiveError
  ) {
    return error.message;
  }
  if (
    error instanceof ConflictException ||
    error instanceof UnprocessableEntityException
  ) {
    const body = error.getResponse() as { message?: string };
    return body.message ?? error.message;
  }
  return 'Could not be installed.';
}

function toHttpError(error: unknown): Error {
  if (error instanceof LibraryArchiveError) {
    return new UnprocessableEntityException({
      code: 'LIBRARY_UNSUPPORTED',
      message: error.message,
    });
  }
  if (error instanceof LibraryRegistryError) {
    if (error.reason === 'not_found') {
      return new NotFoundException({
        code: 'LIBRARY_NOT_FOUND',
        message: error.message,
      });
    }
    if (error.reason === 'unavailable') {
      return new BadGatewayException({
        code: 'LIBRARY_REGISTRY_UNAVAILABLE',
        message: error.message,
      });
    }
    return new UnprocessableEntityException({
      code: 'LIBRARY_INVALID',
      message: error.message,
    });
  }
  return error instanceof Error ? error : new Error('Library request failed');
}
