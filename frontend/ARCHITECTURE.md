# ARCHITECTURE.md

This file is a short entry point. Read the focused docs below instead of the old monolith.

## Start Here

- [Architecture Overview](docs/architecture/overview.md)
- [Architecture Rules](docs/architecture/rules.md)
- [Feature Flows](docs/architecture/features.md)

## What This Platform Is

Angular v22 + Tailwind CSS v4 platform for:

- Admin server monitoring
- IoT project building
- Document management
- AI-assisted project generation
- Device dashboards and deployment
- User, plan, and quota management

## Core Constraints

- Features stay independent and do not import each other directly.
- Components do not call `HttpClient` directly.
- Shared behavior belongs in `core` or `shared`.
- Use signals for local state and signal stores for shared state.
- Use guards for page access and directives for permission-based UI.
- Use `LoggerService` instead of `console.log`.
- Use `CrudWrapper` only for standard CRUD.
- Use explicit service methods for actions like deploy, backup, suspend, and AI generation.

## If You Need More Detail

Open the focused docs above. They contain the long rules, folder structure, feature flows, and examples that were previously packed into this file.
