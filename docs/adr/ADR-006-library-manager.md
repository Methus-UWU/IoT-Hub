# ADR-006: Library Manager from the PlatformIO Registry

- Status: **Accepted — implemented 2026-10-11**
- Date: 2026-10-11
- Related: `docs/adr/ADR-002-build-isolation.md`, `docs/SECURITY.md` § "Library Manager"

## Context

Until now, the only libraries a project could use were the thirteen in
`build-worker/builder/libraries.json`. They are baked into the builder image because
builds run with `--network=none` (ADR-002). Getting a new library, or a newer version
of a baked one, meant editing that list and rebuilding a 2.2 GB image. Users asked
for what Arduino IDE and PlatformIO already offer: search a registry and install.

## Options

1. **Give the builder network access** and let PlatformIO resolve `lib_deps`.
   Rejected: a hostile build could then reach the internet, which ADR-002 rules out.
2. **A shared library cache mounted read-only into the builder**, filled by a
   separate fetcher service. Workable, but it needs a new service, a new volume, cache
   eviction, and a per-build view of which cached versions a project uses.
3. **Install libraries as project files.** The API downloads the archive from the
   registry, unpacks it in memory, and writes the sources to `lib/<Folder>/` in the
   project. PlatformIO and Arduino both compile `lib/` already, the build plan already
   sends `lib/` to the builder, and the builder already validates those paths.

## Decision

Option 3. The builder is unchanged and keeps `--network=none`.

- `src/modules/libraries/` in the API: registry search and package details for any
  signed-in user, and install, list, and remove for a project (`viewer` to list,
  `editor` to change).
- The registry client fetches only `https://api.registry.platformio.org` and archive
  URLs on `*.platformio.org` over HTTPS. Redirects are followed by hand under the same
  rule. Archives are capped at 4 MB while streaming, must match the SHA-256 the
  registry publishes, and inflate to at most 24 MB.
- Archives are parsed in memory by a small tar reader. Only regular files are read;
  links and devices are ignored. Only source files, headers, the manifest, and the
  license are kept. Examples, tests, and docs are dropped, and any file containing a
  NUL byte is dropped too. Paths must pass the project-file segment rules. A library
  may add at most 300 files and 4 MB.
- `build.extraScript` and `scripts` are removed from `library.json`. The builder
  would contain an extra script anyway (ADR-002), but a registry library never brings
  one in.
- Each installed folder holds `library-source.json` (owner, name, version, SHA-256).
  That marker is the only record of what is installed, and the manager replaces or
  removes only folders that have one. A user's own `lib/` code is never overwritten.
- Dependencies named in `library.json` or `library.properties` are installed in the
  same request, up to six libraries. Each name is resolved to its registry owner by
  an exact name search. Libraries that ship with the Arduino cores (`Wire`, `SPI`,
  `WiFi`, …) are skipped, and so is anything the project already has. The library the
  user asked for and its dependencies are written in one transaction, and that
  transaction checks the project quota (500 files, 8 MB).

## Consequences

- Any Arduino library in the registry compiles on the server without an image
  rebuild. Verified on 2026-10-11: PubSubClient 2.8 and ArduinoJson 7.4.3 were
  installed this way and built with the production builder image under the ADR-002
  flags.
- Libraries count against the project quota. ArduinoJson alone is about 150 files.
- Libraries that ship precompiled `.a` files, or files whose names break the path
  rules, are refused or lose those files.
- The browser simulator still runs only the libraries it emulates
  (`simulation/firmware/libraries`). An installed copy of an emulated library is
  ignored in the simulator, so the emulation keeps working.
- Installed library files are not editor tabs. The IDE manages them in the Library
  Manager panel.
- The API now makes outbound requests to the PlatformIO registry. A registry outage
  surfaces as `502 LIBRARY_REGISTRY_UNAVAILABLE`, and only Library Manager features
  are affected.
