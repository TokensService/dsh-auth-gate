# Web admin role management in user management (2026-10-14)

## Decision

`PATCH /auth/users` accepts `admin: boolean` (admin-only): granting sets
`role: "admin"` on the target record, revoking strips the field by rebuilding
the record field-by-field (same discipline as TOTP-disable). `admin: false`
targeting the signed-in user answers `409 self_target` (foot-gun guard
mirroring self-disable; the CLI stays the escape hatch). Non-admin sessions
carrying the `admin` field answer `403 forbidden` (the self-password-only rule
now rejects `disabled`/`totp`/`admin` alike). The user management page gains a
per-row grant/revoke button (disabled on the own row, like disable/delete).
Role changes apply to the target's live sessions immediately: the role is
judged from the record on every request, so a demoted admin's session degrades
to non-admin at once (fail-closed, mirroring the deleted-admin row). POST
create and txt import still mint regular users only - promotion stays a
separate deliberate PATCH. Amends D13/D-UM-7 (CLI-only role management).

## Context

Owner request 2026-10-14: an admin must be able to configure other users as
admin from the user management page. D13 deliberately kept role changes
CLI-only so the web surface could not mint admins; in practice the team runs
several admins and shell access for every grant/revoke became the bottleneck.
The owner accepts the widened blast radius (an admin session can now mint
admins) in exchange for self-service role management.

## Alternatives Considered

- **Keep roles CLI-only** - rejected: fails the stated requirement; the
  shell-only boundary costs more than it protects in a multi-admin deployment.
- **Allow self-demotion via the page** - rejected: same foot-gun shape as
  self-disable/self-delete (D-UM-3); an admin who truly wants to demote
  themselves uses the CLI escape hatch.
- **Separate `POST /auth/users/role` endpoint** - rejected: a new exact route
  duplicates session/admin gating that PATCH already owns; one more field on
  the existing mutation keeps the permission matrix in one place.

## Why

Reusing the PATCH mutation keeps every write path on the same authority (the
admin gate in `handleUserUpdate`) and the same audit log (`user <name> updated
via /auth/users`). The self-target guard preserves the D13 invariant that the
API path cannot remove every admin, without a separate last-admin counter:
self-demotion is the only way to reach zero admins, and it is blocked.
