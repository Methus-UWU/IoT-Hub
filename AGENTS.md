# AGENTS.md

## Project

All-in-one IoT platform built with:

* Angular
* NestJS
* Supabase PostgreSQL
* Supabase Auth
* Supabase Storage
* WebSocket
* isolated build workers

## Language

Use English for:

* code
* filenames
* folder names
* variables
* functions
* classes
* database schema
* API routes
* comments
* technical documentation

Communicate explanations and progress to the user in Thai.

## Core Rules

Always prefer:

* secure implementations
* framework-native features
* reusable code
* low coupling
* high cohesion
* single source of truth
* small coherent changes

Avoid:

* duplicated logic
* giant components
* God Services
* unrelated refactors
* hardcoded secrets
* unsafe user-code execution
* business logic in Angular templates
* SQL in frontend code

## Before Editing

1. Understand the task.
2. Identify impacted modules.
3. Search for reusable existing code.
4. Read only the relevant documentation.
5. Make the smallest coherent change.
6. Run relevant tests and type checks.
7. Report important changes.

Do not scan the entire repository unless necessary.

## Documentation Routing

For overall architecture:

Read:
`docs/ARCHITECTURE.md`

For authentication, authorization, RLS, secrets, uploads, user code execution, or security-sensitive changes:

Read:
`docs/SECURITY.md`

For PostgreSQL, Supabase, migrations, schema, indexes, RLS, or repository changes:

Read:
`docs/DATABASE.md`

For Angular/NestJS naming, folder structure, shared components, code style, and reuse rules:

Read:
`docs/CONVENTIONS.md`

For REST APIs, DTOs, responses, WebSocket events, validation, and versioning:

Read:
`docs/API.md`

For major architectural decisions:

Read relevant files inside:
`docs/adr/`

For carrying out a work item — making a page real, auditing a page, the AI
generator, UI redesign, splitting a large file, deleting suspected dead code, or a
failing command:

Read:
`docs/agent/README.md`

It routes to the right file; do not read the whole pack.

Do not load unrelated documentation.

## Critical Security Rules

Never expose:

* Supabase service-role keys
* database passwords
* JWTs
* refresh tokens
* device secrets
* private keys

Never execute user code in the NestJS API process.

User code must use isolated build workers.

Frontend authorization is UX only.

Sensitive operations require backend authorization.

Use Supabase RLS where appropriate as defense in depth.

## Architecture

Use a modular monolith by default.

Main domains:

* auth
* users
* workspaces
* projects
* knowledge
* community
* libraries
* ai
* build
* devices
* telemetry
* dashboards
* billing
* admin

Do not introduce microservices without a clear reason.

## Angular

Prefer:

* standalone components
* lazy loading
* Signals
* Reactive Forms
* HttpClient
* DestroyRef
* takeUntilDestroyed

Do not duplicate reusable UI behavior.

Generic reusable components belong in `shared/`.

Feature-specific components stay inside their feature.

## NestJS

Controller:
HTTP concerns only.

Service:
business logic.

Repository:
database access.

Guard/Policy:
authorization.

Avoid large controllers and God Services.

Use NestJS DI, Guards, Pipes, Interceptors, Filters, and lifecycle hooks before creating custom infrastructure.

## Database

Supabase PostgreSQL is the primary database.

Use versioned migrations.

Maintain one schema source of truth.

Do not maintain conflicting Prisma, Supabase, and manual SQL schemas.

Prisma may be used only if the architecture explicitly chooses it.

## Definition of Done

A change is complete when:

* types are valid
* validation exists
* authorization exists where required
* no duplicate logic was introduced
* no secrets are exposed
* relevant tests pass
* relevant documentation is updated
* unrelated code was not unnecessarily modified
