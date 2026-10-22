/**
 * The marker the server's Library Manager writes into every library folder it
 * installs (`backend/src/modules/libraries/library-manifest.ts`). A folder with it
 * is managed: its files are not tabs to edit, and the manager may replace them.
 */
export const LIBRARY_MARKER = 'library-source.json';

const MARKER_PATH = /^(lib\/[^/]+\/)library-source\.json$/;

/** `lib/<Folder>/` prefixes of the installed libraries among `paths`. */
export function managedLibraryPrefixes(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    const prefix = MARKER_PATH.exec(path)?.[1];
    return prefix ? [prefix] : [];
  });
}

/** The paths that are the user's own code, without installed library files. */
export function withoutManagedLibraries(paths: readonly string[]): string[] {
  const prefixes = managedLibraryPrefixes(paths);
  if (!prefixes.length) return [...paths];
  return paths.filter((path) => !prefixes.some((prefix) => path.startsWith(prefix)));
}
