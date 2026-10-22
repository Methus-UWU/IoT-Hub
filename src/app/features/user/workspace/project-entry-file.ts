/** Extensions that hold a sketch, most preferred first. */
const SOURCE_EXTENSIONS = ['.ino', '.cpp', '.c'];

/**
 * Picks the file a project's sketch lives in.
 *
 * A `.ino` wins outright. Among files of the same rank the shallowest path wins,
 * because a sketch at the project root (or PlatformIO's `src/main.cpp`) is the
 * entry point and one nested under a library folder is not. Beside other tabs, the
 * one named `main` is the sketch: `alpha.ino` next to `main.ino` is a second tab.
 *
 * The editor, the simulator and the assistant's diagnostics all use this, so they
 * agree on which file "the code" is.
 */
export function pickEntryFile(paths: readonly string[]): string | null {
  const candidates = paths
    .map((path) => ({
      path,
      rank: SOURCE_EXTENSIONS.findIndex((extension) => path.toLowerCase().endsWith(extension)),
      depth: path.split('/').length,
      main: /(^|\/)main\.[^/]+$/i.test(path) ? 0 : 1,
    }))
    .filter((candidate) => candidate.rank !== -1)
    .sort(
      (a, b) =>
        a.rank - b.rank || a.depth - b.depth || a.main - b.main || a.path.localeCompare(b.path),
    );

  return candidates[0]?.path ?? null;
}
