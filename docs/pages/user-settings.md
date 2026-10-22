# /user/settings — Account settings

- Route: `/user/settings`; shared account page also serves `/admin/profile`.
- Files: `frontend/src/app/features/account/profile/`.
- Backend: `backend/src/modules/auth/` and Supabase Auth.
- Status: Real.
- Last verified: 2026-10-11.

## What the user can do here

- Edit their username, display name (60 characters), and bio (280 characters).
  The account chrome uses the display name, falling back to the username when empty.
  Reset unsaved profile changes without losing the saved values.
- Preview, save, replace, or remove their profile photo; the saved photo also appears
  in the user sidebar, public navigation, and admin account card.
- Request an email change and see the address awaiting confirmation.
- Change a password after verifying the current password.
- Show/hide password fields and refresh their sign-in history.

## How it works

Settings use a compact category navigation: Profile, Email and password, and Login history.
AI Profiles is no longer mounted on either account settings route. Old `section=ai`
links fall back to Profile; the IDE's link to that removed section is also removed.
The AI profile editor source is retained but inactive; profile selection and the
underlying AI APIs remain in use by project conversations.
Categories keep form state while switching and wrap to a horizontal row on mobile.
Navigation and content surfaces use the shared surface shadow token. Profile data
already loaded by the route guard is reused; pending account/credential/history
requests use static skeletons. Login history is loaded on first opening and retained
until explicitly refreshed. A failed profile load offers an inline retry.

The Back button returns to the preceding application page, preserving its query
parameters. A history-entry marker survives reloads; direct entry falls back to the
account's user/admin home. Selected categories share the neutral gray sidebar token.
Fields indicate focus through their border rather than an outer outline, and the
bio textarea cannot be manually resized.

The account content stays behind its skeleton until both the profile and avatar
have settled. Downloaded avatars are decoded before publishing their blob URL.
Missing photos use initials; download/decode failures end loading with an inline
message, and downloads have a 15-second timeout. Saving a profile does not restart
the initial loading state.

The sidebar three-dot button opens a native disclosure with Settings and Logout.
Hover and focus affect only the button; the identity card is not interactive.
The dropdown closes on outside click, focus leaving it, Escape, or selecting
Settings. Escape returns focus to the trigger. Community links open `/community` from both the project
list and the project workspace, with documentation available alongside it.

`AuthService` reads and patches `/api/auth/me` for profile fields. The existing
backend validates and authorizes profile writes. Client username limits match
`UpdateProfileDto` (2–40 characters). Email changes use Supabase `updateUser`,
with `/auth/callback` as the confirmation return URL. The session's confirmed
email stays visible while `new_email` is pending; no email is sent to the profile
API. The existing database trigger synchronizes confirmed email changes.
Password changes reuse the existing password verification and update flow.
Credential forms are available only to sessions authenticated with a password.
The Supabase SDK reads the session's authentication methods (AMR), so linked
Google/GitHub accounts are handled by the current sign-in method, not the account's
original provider. OAuth and unknown methods show explanatory text instead.
`AuthService` repeats this check before sending email/password updates. This is an
application UX policy, not an additional restriction on Supabase's direct Auth API.
Username and avatar editing remain available for all authenticated account types.
See [Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser).

## Decisions made here

The previously admin-only profile page moved to the account feature and is reused
by both routes. No account forms are duplicated. The account dropdown uses native
`details`/`summary` behavior with links and buttons, and keeps logout inside it.
Avatars use a separate authenticated API and a private `account-avatars` Storage
bucket, created on the first upload. `SUPABASE_SECRET_KEY` must be available to the
backend. No database migration or client Storage policy is required. The backend
checks the current account is active and derives the object key from the verified
subject, never a client-supplied owner or filename. Images are downloaded through
the authorized API as blobs; no public URLs or service credentials reach the browser.

The browser accepts JPEG/PNG/WebP up to 5 MB and opens an inline crop editor with
drag positioning, keyboard-accessible horizontal/vertical sliders, 1–3× zoom, reset,
and cancellation. Saving exports the visible crop as a 256 × 256 PNG. Previously
saved photos can be cropped again, using the saved image rather than the original
upload. Failed uploads retain the crop for retry and leave the saved avatar intact.
Nest's file validator checks magic bytes, limits uploads to 512 KiB,
and rejects PNG dimensions over 512 × 512. The stored object is replaced in place;
deleting it restores initials. Blob URLs are revoked on replacement and sign-out.
The existing 1 MiB proxy body limit is sufficient, so Nginx is unchanged.
These are private account photos; community author badges continue to use initials.

## Verification

Latest UI follow-up: frontend build and 30 Playwright account/identity/credential
tests passed. New coverage checks Back before/after reload and direct-entry fallback,
neutral selected/focus states, disabled bio resizing, delayed avatar loading without
partial content, and recovery from avatar download failure.

2026-10-11 update: frontend/backend builds passed; 25 Playwright account/identity/
credential tests and 34 backend profile/authorization/avatar tests passed. Browser
coverage includes crop pixels matching the upload, drag/keyboard/reset/mobile,
profile details surviving reload, cached display names during refresh, clearing
optional fields, profile load failure/retry, and retained history.
The additive migration `20261011010000_account_profile_details` was verified in an
isolated PostgreSQL 17 container for nullable defaults, Unicode round trips, length
limits, clearing, and retained read isolation/write privileges. Apply this migration
before deploying the updated API; live Supabase was not changed in this verification.

From `frontend`:

- `npm.cmd run build`: passed in both frontend and backend.
- `npx.cmd playwright test e2e/account-settings.spec.ts e2e/account-display.spec.ts`:
  14 passed. Covers desktop
  hover/navigation, mobile drawer and width, profile validation/error/success,
  email validation/error/pending confirmation, password mismatch/current-password
  rejection/success, logout, avatar preview/cancel/upload/reload/delete, malformed
  input and failed uploads, plus existing account identity regressions.
- Backend `npm.cmd test -- avatar --runInBand`: 11 passed. Covers authenticated
  owner scope, suspension, spoofed MIME, size/dimension limits, missing files,
  private bucket provisioning, provider errors, and deletion.
- Credential policy: `npx.cmd playwright test e2e/credential-settings.spec.ts
  e2e/account-settings.spec.ts`: 13 passed. Includes Google, GitHub, linked accounts
  signed in with OAuth or password, unknown methods, and existing account flows.
  Authentication-method fixtures use a structurally valid synthetic JWT; no live
  OAuth credentials or user accounts are modified.
- Screenshots: `.tmp/account-settings-desktop.png` and
  `.tmp/account-settings-mobile.png` (viewport captures; main content scrolls).

Browser tests mock authenticated API/provider responses. Storage tests mock the SDK;
live bucket creation/upload/download and email delivery/confirmation have not been
exercised. Confirmation behavior depends on the
project's Supabase Auth configuration. Password changes require an existing
password; Google/GitHub OAuth sessions cannot change credentials through this form.
Plan data retains the limitations documented in the page inventory.
