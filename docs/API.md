# API

## Base Route

Use versioned APIs.

Example:

`/api/v1`

## Controllers

Controllers should:

* receive validated requests
* call services
* map results to HTTP responses

Controllers should not contain:

* SQL
* complex business logic
* direct payment verification logic
* large authorization workflows

## DTOs

Validate all external input.

Use DTOs for:

* request body
* route parameters
* query parameters

Do not trust Angular validation as a security boundary.

## Success Response

Recommended structure:

{
"data": {},
"meta": {}
}

Use `meta` for:

* pagination
* cursors
* totals
* additional response metadata

## Error Response

Recommended structure:

{
"error": {
"code": "PROJECT_NOT_FOUND",
"message": "Project not found",
"requestId": "..."
}
}

Use stable machine-readable error codes.

## Domain Errors

Prefer domain errors such as:

* ProjectNotFoundError
* ProjectAccessDeniedError
* DeviceOfflineError
* BuildTimeoutError
* QuotaExceededError

Map domain errors centrally to HTTP responses.

Do not repeat try/catch logic in every controller.

## Authorization

Every protected endpoint must authorize on the backend.

Depending on the resource, check:

* user identity
* workspace membership
* role
* ownership
* entitlement

## Pagination

Do not return unlimited collections.

Support pagination.

Use cursor pagination when collections can become large.

## Realtime

Use WebSocket for interactive realtime flows such as:

* telemetry updates
* dashboard state
* build status
* device online/offline events

Use REST for resource CRUD unless realtime semantics provide a clear benefit.

## WebSocket Events

Use clear versioned event contracts.

Example:

`telemetry.updated`

`device.status.changed`

`build.status.changed`

Do not send arbitrary undocumented payload shapes.

## Idempotency

Use idempotency for operations where retries may create duplicates.

Examples:

* payment webhooks
* subscription updates
* some provisioning operations

## Rate Limiting

Apply stricter limits to:

* authentication
* AI
* build requests
* device provisioning
* expensive searches
* public write endpoints
