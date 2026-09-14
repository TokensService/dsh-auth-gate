# User management settings page + `/auth/users` API (implementation spec)

> **Status**: implemented
> **Scope**: standalone slice on top of M3 (password mode) + M4 (TOTP); password mode only
> **Source**: user request 2026-09-14 ("add a page in dsh settings to add/edit/delete users and view their status")

## 1. Background

User administration (`users.yaml`) previously required shell access: the
`dsh-auth user` CLI (add/list/disable/totp) is the only interface, and the
dsh RPC channel cannot help - its privileged methods are pinned to loopback
(`PRIVILEGED_METHODS`), so a public deployment gets 403 for `settings.*`
regardless of authentication. Meanwhile the plugin already owns a same-origin,
session-carrying channel (`/auth/*`) and a client half that mounts UI into the
dsh settings modal. This slice adds a **User Management page** to the settings
modal (`settings.section` slot) backed by a new session-guarded JSON API, so an
authenticated admin can list, add, edit, disable/enable, TOTP-enable/disable
and delete users from the browser.

## 2. Behavioral contract

| Scenario                                       | Behavior                                                                                                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any call without a valid session               | `401 {"error":"unauthorized"}` (session cookie or Bearer session token; the endpoint checks itself)                                                                                                               |
| Session store unavailable                      | `503 {"error":"store_unavailable"}`                                                                                                                                                                               |
| `GET /auth/users`                              | `200 {"users":[{username,disabled,totp,admin,current}]}`, sorted by username, never contains hashes/secrets; readable by any session                                                                              |
| `POST` new user (admin only)                   | validate username (`USERNAME_RE`) + non-empty password -> scrypt hash -> atomic rewrite; `201` + user view                                                                                                        |
| `POST`/`DELETE` with a non-admin session       | `403 forbidden` (D13: user management is admin-only)                                                                                                                                                              |
| `PATCH` with a non-admin session               | only the **own password** may change; other targets or `disabled`/`totp` fields -> `403 forbidden`                                                                                                                |
| `POST` duplicate / invalid username / empty pw | `409 duplicate` / `400 invalid_username` / `400 empty_password`                                                                                                                                                   |
| `PATCH` password                               | re-hash with fresh salt; old password stops verifying immediately                                                                                                                                                 |
| Username change                                | unsupported: the username is the primary key; no role can rename via API/page (delete + recreate instead)                                                                                                         |
| `PATCH disabled:true` on self                  | `409 self_target` (foot-gun guard; the CLI stays the escape hatch)                                                                                                                                                |
| `PATCH disabled:true` / `DELETE` last enabled  | `409 last_enabled` (lockout prevention: at least one enabled user must remain)                                                                                                                                    |
| `PATCH totp:"enable"`                          | generates a secret, persists it, and returns `{totpSecret,totpUri}` **once** (409 `totp_exists` if set)                                                                                                           |
| `PATCH totp:"disable"`                         | removes the secret (idempotent, preserves `role`)                                                                                                                                                                 |
| `DELETE` user (admin only)                     | removes from `users.yaml`; `200 {"deleted":name}`; self-delete -> `409 self_target`                                                                                                                               |
| Non-JSON body on mutations                     | `415 unsupported_media_type` (forms cannot forge a JSON content type; CSRF layer on top of SameSite=Lax)                                                                                                          |
| Body > 16 KiB / invalid JSON                   | `413 body_too_large` / `400 bad_json`                                                                                                                                                                             |
| Disabled/deleted user with live sessions       | sessions stay valid until expiry (D8: `revokeBySubject` deliberately not implemented; shown in the UI); the role is judged from the record - a deleted admin's live session loses management rights (fail-closed) |
| Token mode                                     | endpoint not registered -> `/auth` catch-all `404`; the settings page shows an "unavailable" notice                                                                                                               |
| users.yaml read/write failure                  | `503 user_store_unavailable` + error log                                                                                                                                                                          |

Fail-closed scope: the endpoint lives under the `/auth` gate whitelist, so it
re-implements session validation itself (cookie first, Bearer session token as
fallback - the same session model as the gate). All error responses are JSON
with stable machine codes; the client localizes by code, never by message text.

## 3. Frozen design decisions

- **D-UM-1**: the API is an exact route `/auth/users` with internal method
  dispatch (GET/POST/PATCH/DELETE), consistent with the existing auth
  endpoints (no method routing in `webServer`).
- **D-UM-2**: mutations accept only `application/json` (CSRF hardening over
  SameSite=Lax); bodies are capped at 16 KiB like the urlencoded parser (M10).
- **D-UM-3**: server-enforced protections - no self-disable/self-delete, no
  removing the last enabled user. The page additionally disables those buttons
  for the current user, but the API is the authority.
- **D-UM-4**: TOTP capability is injected from `index.ts`
  (`generateTotpSecret`/`totpUri` from `features/totp`) - the D9 assembly
  pattern, since feature slices may not import each other.
- **D-UM-5**: `revokeBySubject` stays unimplemented (D8); the page shows a
  footnote that disable/delete only blocks new logins.
- **D-UM-6**: the page is a whole `settings.section` (id `auth-users`,
  order 30: after the built-in sections `general` 0 / `models` 10 /
  `plugins` 15 / `agent-presets` 20, before third-party pages like
  `better-sidebar` 100); fixed constant, no config knob (D4 was driven by a
  real collision risk that does not apply to the sparsely populated section
  band). Texts ship in the `auth` locale namespace (zh/en), error keys are
  `users.error.<code>`.
- **D-UM-7** (D13): `users.yaml` records gain an optional `role: "admin"`
  (absent = regular user; the strict zod schema accepts only the literal
  `admin`). Roles are granted/revoked via the CLI only
  (`dsh-auth user add --admin` / `dsh-auth user admin <enable|disable> <name>`) -
  the API never changes roles, so the web surface cannot mint new admins;
  privilege escalation requires shell access.
- **D-UM-8** (D13): permission matrix - GET is readable by any session;
  POST/DELETE are admin-only; for PATCH an admin may edit any user while a
  non-admin may only change their own password (other targets/fields ->
  `403 forbidden`). The page degrades its UI from `users[].admin` +
  `current` (hiding the add form and other rows' action buttons), but the
  API is the authority; every write path that rebuilds a record must
  preserve `role` (TOTP-disable rebuilt field-by-field and was fixed).

## 4. Deployment notes

- Zero new configuration; password mode mounts the endpoint automatically,
  token mode does not register it at all.
- No new dependencies; `users.yaml` gains a **backwards-compatible optional
  field** `role` (existing files: every user is a regular user). The CLI and
  the API operate on the same file with the same atomic write
  (`writeUsersFile`).
- **Upgrade migration**: after upgrading to a release with D13, existing
  users are all non-admin and management mutations return 403 - grant admin
  via the CLI first: `dsh-auth user admin enable <name>` (or create one with
  `dsh-auth user add <name> --password-stdin --admin`). `dsh-auth user list`
  marks roles as `(admin)` / `(admin, disabled)`.
- TOTP enable via the page prints the base32 secret + otpauth URI once in the
  response; the admin copies it into the authenticator manually (no QR image,
  keeping the bundle self-contained).
- Audit: add/update/delete write `user <name> added|updated|deleted via
/auth/users` info logs; secrets/hashes are never logged.

## 5. Tests

- Unit: `src/features/password/user-admin-endpoints.test.ts` (auth matrix,
  Bearer fallback, 405, list with admin markers + a non-admin view, create +
  400/409/415 cases, non-admin POST 403) and
  `user-admin-endpoints.update.test.ts` (password change round-trip,
  disable/enable, self/last-enabled guards, TOTP enable/disable, delete, the
  non-admin matrix: own-password only / everything else 403 / a deleted
  admin's live session degrades). Shared harness:
  `test/user-admin-harness.ts` (real `users.yaml` round-trip in a temp dir +
  in-memory session table).
- Integration: `src/integration.users.test.ts` - real stack
  (storage-json + storage-domain + WebServer + plugin): unauthenticated 401,
  list with `current`/`admin` markers, create -> real sign-in, duplicate 409,
  self-target 409, delete persistence, 405/415, the non-admin 403 matrix +
  self-service password change followed by a real re-login.
- Client: `src/client/users-section.test.tsx` (states + mutations + TOTP
  reveal + the degraded non-admin UI); `src/client/logout-action.test.tsx`
  extended for the section registration and merged dictionaries.
- CLI/file: `src/cli.test.ts` (`--admin`, `user admin enable/disable`, list
  role markers) and `src/shared/users-file.test.ts` (role parsing / rejecting
  invalid values / write-read round-trip).

## 6. Change log

| commit        | content                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| 5508640       | feat: user management settings page + `/auth/users` API                          |
| (this change) | feat: admin role + permission matrix (D13), CLI role management, role-aware page |
