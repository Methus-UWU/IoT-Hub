# Conventions

## Language

Use English for:

* source code
* filenames
* folders
* variables
* functions
* classes
* database schema
* API routes
* technical documentation

## TypeScript

Use strict mode.

Avoid `any`.

Prefer explicit domain types.

Keep functions focused on one responsibility.

Avoid unnecessarily large files.

Do not split trivial logic into excessive abstraction.

## Angular Structure

Use:

core/
shared/
features/
layout/

Feature-specific code stays inside its feature.

Generic reusable components belong in `shared/`.

Do not move a component to shared merely because two files look similar.

Reuse must represent genuinely common behavior.

## Shared UI

Common reusable components may include:

* Button
* Input
* Select
* Dropdown
* Dialog
* Modal
* Table
* Pagination
* Tabs
* Tooltip
* Toast
* Card
* Badge
* Page Header
* Empty State
* Loading State

Do not copy custom dropdown implementations between pages.

## Angular State

Use Signals for local UI state where appropriate.

Use RxJS for stream-oriented asynchronous behavior.

Avoid global state unless data genuinely needs global ownership.

## NestJS

Controllers:
HTTP concerns only.

Services:
business logic.

Repositories:
database access.

Guards/Policies:
authorization.

Mappers:
API/domain transformations.

Do not write SQL inside controllers.

## Naming

Use descriptive names.

Avoid generic names such as:

* helper
* utils2
* dataService
* manager
* processData

unless the scope clearly justifies them.

## Configuration

Centralize:

* API URLs
* routes
* permissions
* plan limits
* board metadata
* feature flags
* theme tokens

Do not duplicate constants across features.

## Dependencies

Before adding a library, evaluate:

* maintenance
* security history
* ecosystem adoption
* bundle impact
* license
* native framework alternatives

Prefer framework-native tools first.

Use mature libraries when they reduce meaningful complexity or security risk.

## Refactoring

Do not perform unrelated mass refactors during feature implementation.

When duplicated behavior is discovered:

1. determine whether it is genuinely reusable
2. extract the smallest useful abstraction
3. migrate relevant callers
4. avoid changing unrelated behavior

## Comments

Comments should explain:

* why
* security assumptions
* non-obvious architecture decisions

Do not comment obvious code line-by-line.
