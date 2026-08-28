import { BadRequestException } from '@nestjs/common';

/**
 * Path safety for project files.
 *
 * Lifted unchanged from the filesystem-backed `WorkspaceService`, which the legacy
 * audit identified as the strongest security code in the repository. The rules are
 * preserved exactly — same segment allow-list, same depth limit, same rejections —
 * because weakening them during a storage migration is precisely the kind of
 * regression this move could otherwise introduce.
 *
 * Files no longer touch a filesystem, so the "escapes the project directory" check
 * is gone; a traversal attempt is now rejected by the segment rules alone, and the
 * database repeats those rules as a CHECK constraint. Keeping the validation here
 * means an unsafe path also cannot become an unsafe Storage object key later.
 */

/** A single segment: starts alphanumeric, then word characters, dots, or hyphens. */
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const MAX_PATH_SEGMENTS = 12;
const MAX_PATH_LENGTH = 240;

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_PROJECT_FILES = 500;
/** Total across a project, so many medium files cannot bypass the per-file cap. */
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;

/**
 * Normalises a client-supplied path to its canonical form, or rejects it.
 *
 * Rejects absolute paths, `.` and `..` segments, empty segments, backslash tricks,
 * over-long paths, over-deep paths, and any segment outside the allow-list.
 */
export function normalizeProjectFilePath(filePath: string): string {
  const candidate = filePath.trim().replaceAll('\\', '/');

  if (!candidate || candidate.startsWith('/')) {
    throw new BadRequestException({
      code: 'INVALID_FILE_PATH',
      message: 'A relative project file path is required',
    });
  }

  if (candidate.length > MAX_PATH_LENGTH) {
    throw new BadRequestException({
      code: 'INVALID_FILE_PATH',
      message: `A project file path is limited to ${MAX_PATH_LENGTH} characters`,
    });
  }

  const segments = candidate.split('/');
  const unsafe =
    segments.length > MAX_PATH_SEGMENTS ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        !SAFE_SEGMENT.test(segment),
    );

  if (unsafe) {
    throw new BadRequestException({
      code: 'INVALID_FILE_PATH',
      message: 'Project file path contains an invalid segment',
    });
  }

  return segments.join('/');
}

export function assertFileWithinSizeLimit(content: string): number {
  const sizeBytes = Buffer.byteLength(content, 'utf8');

  if (sizeBytes > MAX_FILE_BYTES) {
    throw new BadRequestException({
      code: 'FILE_TOO_LARGE',
      message: `Project files are limited to ${MAX_FILE_BYTES} bytes`,
    });
  }

  return sizeBytes;
}
