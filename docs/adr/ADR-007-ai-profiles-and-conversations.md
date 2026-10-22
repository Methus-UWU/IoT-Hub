# ADR-007: AI Profiles and Server-side Conversations

- Status: **Accepted — implemented 2026-10-11** (migration applied separately)
- Date: 2026-10-11
- Related: `docs/API.md` § "AI profiles and conversations", `docs/DATABASE.md`

## Context

The project assistant's conversations lived in the browser tab's `sessionStorage`.
That caused four problems:

- They were lost when the tab closed.
- One list was shared by every project the tab opened.
- The client sent the whole history with every turn.
- The model and reasoning tier were hard-coded per request (`profile: 'balanced'`).

The brief asked for:

- AI profiles (model, system prompt, settings) kept separate from conversations.
- History separated by user and project.
- Switching profile without losing history.

## Decision

Three additive tables: `ai_profiles`, `ai_conversations`, `ai_messages`. Migration:
`20261011000000_ai_profiles_and_conversations`.

### Profiles

A profile has a name, a description, an optional catalog `model`, a `tier`
(`auto` | `balanced` | `deep`), and up to 4000 characters of `instructions`.

Ownership:

- A user owns up to 20 personal profiles.
- A profile with a null `owner_id` is a system profile: every user may choose it, and
  only platform admins may create, change, or delete it. The admin role is checked
  against the database on each write.
- Someone else's personal profile is a 404.

How a profile changes a turn:

- Its model and tier replace the request's.
- Its instructions are appended after the platform system prompt, in a fenced block
  that ranks them below the platform rules. They change tone and focus only. They
  cannot add tools, reach another project, or skip the proposal step, because the
  tools and the project scope are fixed by the server, not by the prompt.

### Conversations

A conversation belongs to one user and one project.

- The routes need `viewer` on the workspace and the project-in-workspace check.
- A conversation of another user, or of another project, is a 404.
- Up to 50 are kept per user per project. Starting one more deletes the least
  recently used.

### Turns

A chat request that carries `conversationId` runs this way:

1. The server reads the history from `ai_messages`: the last 29 turns.
2. It reads only the last user message from the request.
3. It stores the question.
4. It runs the turn with the conversation's profile.
5. It stores the answer, together with the plan it proposed.

The client then records what became of the plan (`applied`, `failed`, `dismissed`).
Applying a plan is still authorized separately, at `editor`, by `POST .../ai/apply`.

A request without `conversationId` behaves as before, so older clients keep working.

### Switching profile

`PATCH .../ai/conversations/:id { profileId }` changes the profile used from the next
turn on. Earlier messages are untouched. If a profile is deleted, its conversations
fall back to the default (`ON DELETE SET NULL`).

### Client

`ProjectAiChatStore` holds the open project's conversation list and caches each
conversation it has read, so switching between them costs no request.

- A new chat is a local draft until its first question, so opening the panel never
  creates empty rows.
- An answer is written to the conversation it was asked in, even if the user opened
  another one meanwhile.
- Skeletons cover the list and message loads.

`AiProfilesStore` supplies profile choices to the IDE panel.

### Shared settings page (Goal 8)

`/user/settings` and `/admin/profile` render one `ProfilePage`. The AI Profiles
section was initially added here, then removed at the user's request on 2026-10-11.
Its editor source is retained but no longer mounted, and the IDE no longer links to
it. Existing conversation profile selection and server authorization are unchanged.

## Consequences

- Conversations follow the user across browsers and devices, and stay with their
  project.
- Chat text is now stored. Members of the same workspace cannot read each other's
  conversations: the API checks the owner, and RLS repeats the check for the Data
  API. Deleting a project or a user cascades to their conversations.
- Old sessionStorage conversations recorded no project, so they cannot be assigned
  automatically. Since 2026-10-11 the assistant panel offers to import them into the
  open project (`POST .../ai/conversations/import`, messages only, no plans) or to
  discard them. They stay in the tab until the user chooses. Tabs that loaded the first
  ADR-007 build had already cleared them.
- Unsent text and the "waiting for an answer" state are kept per project, so neither
  follows the user into another project's panel.
