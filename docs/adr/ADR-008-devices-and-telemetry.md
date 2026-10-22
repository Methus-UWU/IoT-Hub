# ADR-008: Devices and Telemetry

- Status: **Accepted — implemented 2026-10-11**
- Date: 2026-10-11
- Related: ADR-007, `docs/API.md` § "Devices and telemetry", `docs/DATABASE.md`

## Context

Phase 4a gave projects datastreams and dashboards, but no real board could send
anything. The brief (Goal 6.2) asks for Blynk-style devices: one template or dashboard,
many boards, each with its own Device ID and online status.

## Decision

### Devices

A device belongs to a project and has:

- a name;
- a token of the form `iot_` + 32 URL-safe characters (24 random bytes);
- a token hint: the token's last four characters;
- `last_seen_at`.

The token is returned once, at creation or rotation. The database stores only its
SHA-256. Its `token_hash` column is not granted to the Data API, so neither a database
read nor a Data API query can impersonate a device. Rotating a token cuts off the old
one immediately.

A project may have up to 20 devices. A device is online when it was heard from in the
last 60 seconds.

### Board API

`/api/device/v1` takes the header `Authorization: Device <token>`, or `X-Device-Token`.
`DeviceTokenGuard` resolves the token to exactly one device. The token reaches no user
route.

- `POST telemetry { values: { key: value } }`:
  - Each key must be one of the project's datastreams, and its value must have that
    datastream's type.
  - Mismatched keys come back in `rejected` and do not fail the report.
  - Up to 32 values per report.
  - Each device may send a burst of 10 reports, then one per second.
  - `last_seen_at` is written at most every 10 seconds.
- `GET controls` returns the values that dashboard controls set (`source = 'app'`), for
  the board to apply.

### Storage

- `device_values` holds the latest value per device and key, for widgets.
- `telemetry_points` holds the reported history for charts:
  - numbers and booleans go in `value`, text in `text`;
  - points are kept for 30 days and pruned at most hourly from the report path.
- A control value is not history.

### Dashboard

- The dashboard document's existing `deviceScope` field now holds the id of the device
  shown in preview. Older values such as "All devices" simply select none.
- In preview, `DashboardLive`:
  - polls the latest values every 5 seconds, and the history every 30 seconds;
  - polls only while the tab is visible;
  - stops when the page goes.
- `applyLive` overlays the values on the widgets for display only, so live values never
  reach the saved document.
- Switches, sliders, buttons, and numeric inputs send `PUT .../devices/:id/values/:key`,
  which needs `editor`.
- The line chart draws the real history, averaged on the server into at most 120 points.
- The other charts still show sample shapes.
- The Devices panel lists boards and their status, issues and rotates tokens, and shows
  an ESP32 sketch that reports to the new token.

## Options not taken

- **MQTT broker.** It is the more common IoT transport, but it needs a new service, its
  own authentication, and a bridge to the database. HTTPS polling works with the stock
  ESP32 `HTTPClient` and the existing API. The board API is versioned (`/device/v1`)
  so an MQTT ingress can be added beside it later.
- **WebSocket push to dashboards.** Deferred with the rest of the gateway (ADR-002 item
  9). Five-second polling of one small row set is cheap at this scale.

## Consequences

- Real boards can report values and receive controls. Dashboards show them per device.
- The ESP32 sample uses `setInsecure()` for a first test, and says so. A production
  sketch should pin the server certificate.
- The per-device rate limit lives in API memory, so it is per API instance. That is
  correct for the single-instance deployment. Several instances would need a shared
  limiter.
