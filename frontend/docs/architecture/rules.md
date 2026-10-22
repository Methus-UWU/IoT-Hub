# Architecture Rules

## Core Principles

- Keep features loosely coupled.
- Keep classes focused on one responsibility.
- Keep cross-cutting concerns in `core`.
- Keep reusable UI in `shared`.

## State Management

- Use signals for local component state.
- Use feature-level signal stores for shared feature state.
- Use root-level signal stores for global app state.
- Do not mutate signals directly; use `set` or `update`.

## API Rules

- Components must not call `HttpClient` directly.
- Use services as the API boundary.
- Route requests through auth, loading, error, and logging interceptors.

## CRUD Rule

- Use `CrudWrapper` for standard resources such as projects, documents, devices, users, plans, and backups.
- Do not use it for special actions like login, deploy, backup creation, restore, suspend, or AI generation.

## Permission Rules

- Use guards for route access.
- Use directives for UI visibility.
- Keep quota checks out of components.

## Logging and Loading

- Use `LoggerService` for logs.
- Do not use `console.log` in features.
- Use interceptor-driven global loading.
- Keep local loading only for small UI actions.

## Realtime Rules

- Use RxJS for MQTT, WebSocket, polling, and log streams.
- Use `takeUntilDestroyed()` for manual subscriptions.

## UI Rules

- Use Tailwind CSS v4.
- Prefer accessible, responsive dashboard-style layouts.
- Use Angular CDK for complex UI behavior.

## Golden Rules

- Features must not import other features directly.
- Components must stay small and avoid long business logic.
- Use typed forms or signal forms for real forms.
- Use ngx-translate for user-facing text.
- Keep every feature independent but able to share common infrastructure.
