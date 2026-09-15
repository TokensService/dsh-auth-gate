# Admin role and permission matrix for user management (2026-09-14)

## Decision

`users.yaml` records gain an optional `role: "admin"` field (absent = regular
user; the strict schema accepts only the literal `admin`). Permission matrix for
`/auth/users`: GET is readable by any session; POST/DELETE are admin-only; for
PATCH an admin may edit any user while a non-admin may only change their own
password (other targets or `disabled`/`totp` fields -> `403 forbidden`). The
username is the primary key and cannot be renamed via API/page by any role.
Roles are granted/revoked via the CLI only
(`dsh-auth user add --admin` / `dsh-auth user admin <enable|disable> <name>`);
the API never changes roles. The settings page degrades its UI from
`users[].admin` + `current` (non-admins see neither the add form nor other
rows' action buttons), but the API is the authority.

## Context

The user management page (D12) shipped with the single-gate model's implicit
assumption: "signed in = allowed to manage users". Any session holder could
add/edit/delete every user, including disabling others and resetting their
TOTP. The follow-up requirement tightens this: only admins may add users or
change other users' passwords; non-admins may only change their own password
and cannot rename themselves. Existing `users.yaml` files have no role concept,
so the upgrade needs an explicit bootstrap path (otherwise the page's
management features lock out everyone).

## Alternatives Considered

- **First user is admin / admin list in plugin config** - rejected: implicit
  rules drift as users come and go (delete the first user and the rights shift),
  and config plus users.yaml would be two sources of truth; a record field
  stays consistent through the same atomic write.
- **Expose role changes in the API (admins granting admin)** - rejected: if the
  web surface can mint admins, the "privilege escalation requires shell"
  boundary is gone; the requirement only tightens permissions, it does not ask
  for web-side grants.
- **Hide the list from non-admins too** - rejected: the page needs the own row
  for self-service password changes; usernames/status are not secret (the login
  page is public), and the requirement constrains mutations only.
- **Add a last-admin guard on top of last_enabled** - rejected: self-target
  already blocks self-disable/self-delete, and the actor must be an admin, so
  the API path cannot remove every admin; the CLI stays the escape hatch.

## Why

Storing the role inside the record (same atomic write as the password hash and
TOTP secret) keeps the permission check free of extra data sources. CLI-only
role management pins the web surface's blast radius to "an admin's own
session". Fail-closed detail: a deleted admin's live session loses management
rights because the record is gone (D8's no-revocation semantics preserve the
login, not the privileges). The UI degradation is a convenience layer; 403 is
always enforced server-side.
