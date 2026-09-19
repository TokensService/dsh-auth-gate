# Runtime-configurable login timeout (settings.yaml + /auth/settings) (2026-09-15)

## Decision

The User Management settings page gains a "Login timeout" setting: an admin
can view and change the session TTL at runtime. The value lives in a new
`settings.yaml` next to users.yaml (strict zod schema, atomic 0600 write, the
same discipline as writeUsersFile) and is exposed through a new exact route
`/auth/settings` (password mode only: GET answers any session with
`{sessionTtl, defaultTtl}`; PATCH is admin-only, integer seconds in
[60, 31536000], a full-file write that self-heals a corrupted file). The login
path re-reads the file per session issue, so a change affects only newly
issued sessions - existing sessions expire on their original schedule.
Non-admin sessions see the current value read-only; token mode does not
register the endpoint (the page keeps its "unavailable" notice).

## Context

The session TTL was previously a static plugin config value (`sessionTtl`,
default 604800 seconds). Changing it meant editing cordis.patch.yml and
restarting - acceptable for infrastructure, clumsy for day-to-day policy. The
user management page (2026-09-14) already gives admins a session-guarded
management surface, so the timeout setting joins it there.
`IssueSessionDeps.sessionTtl` changes from a static number to a per-issue
resolver: the password-mode wiring reads settings.yaml first and falls back to
the configured value (read errors are logged but not fatal: the TTL is not an
auth boundary, and file corruption surfaces to admins as
`503 settings_store_unavailable` on the management API).

## Alternatives Considered

- **Cordis config override only** - rejected: it needs a restart and shell
  access, which defeats runtime management by an admin from the browser.
- **A new table in the session storage domain** - rejected: the domain spec is
  versioned and the migration semantics of the rc dependency are unknown
  territory; a settings row also outlives individual sessions conceptually.
  The file approach stays fully under this repo's control and already has an
  atomic-write pattern to copy.
- **A top-level key inside users.yaml** - rejected: the strict version-1
  schema would reject it; bumping the users file version to carry a non-user
  setting mixes two concerns into one migration.
- **Apply the new TTL to existing sessions (sliding renewal or immediate
  re-issue)** - rejected: silently shortening live sessions logs people out,
  silently lengthening them defeats tightening the timeout. "New logins only"
  matches the page's existing footnote (disable/delete blocks new sign-ins
  only).

## Why

The file approach adds zero configuration, zero dependencies and one small
exact route, reuses the users.yaml read/write discipline (per-operation reads,
atomic write, 0600), and keeps every failure mode explicit: the API answers
503 on store errors while logins degrade to the configured default with an
error log. Admin-only writes keep the D13 permission matrix intact (privilege
changes still require shell), and the [1 minute, 365 days] bounds plus the
page's whole-hour input keep foot-guns out without inventing new concepts.
