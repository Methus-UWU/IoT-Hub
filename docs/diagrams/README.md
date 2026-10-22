# IoT Hub ER diagram

Open `iot-hub-erd.html` for zoom controls, relationship highlighting, and the full
cardinality index. Use SVG for editable vector artwork, PNG for sharing, and PDF
for a single-page vector poster. The preview PNG is a smaller overview.

The diagram represents the repository schema as of 2026-10-18: 33 public tables,
262 columns, and 48 foreign keys. `auth.users` is an external reference with only
its referenced `id` shown. This is not a live database introspection.

The ten colors identify identity/access, workspaces, projects/circuits, billing,
community, activity/history, firmware builds, dashboards/datastreams,
devices/telemetry, and AI assistant/credits. PK/FK/UQ identify primary, foreign, and unique
keys. A question mark after a type means nullable; other columns are NOT NULL.
Composite unique constraints appear below the table. Lines point from each
foreign key to its referenced key; hover for cardinalities or open the HTML
relationship index. `0..N` means zero or more children.

Physical PostgreSQL types and nullability are checked against migration DDL.
The generator reads `backend/prisma/schema.prisma` and its migration history;
it never connects to the database or reads environment credentials. Future
SQL-only schema changes must be reflected in the generator when applicable.

Regenerate from the repository root:

```sh
node docs/diagrams/generate-erd.mjs
node docs/diagrams/export-erd.cjs
```

The export command uses the frontend's installed Playwright and Chromium. It
checks entity/relationship counts, table text bounds, browser errors, and the
interactive highlighting before rendering.

The supplied reference image guides the grouped color panels and table styling;
its education-domain entities are not part of this project's schema.

## System overview

`system-overview.png` is a rendered copy of the Mermaid diagram in
`docs/ARCHITECTURE.md` § "System Overview", for viewers that cannot render Mermaid.
The Markdown block is the source. Re-render after editing it (loads Mermaid from
jsDelivr, so it needs network access):

```sh
node docs/diagrams/export-system-overview.cjs
```
