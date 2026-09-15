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

| Scenario                                         | Behavior                                                                                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any call without a valid session                 | `401 {"error":"unauthorized"}` (session cookie or Bearer session token; the endpoint checks itself)                                                                                                               |
| Session store unavailable                        | `503 {"error":"store_unavailable"}`                                                                                                                                                                               |
| `GET /auth/users`                                | `200 {"users":[{username,disabled,totp,admin,current}]}`, sorted by username, never contains hashes/secrets; readable by any session                                                                              |
| `POST` new user (admin only)                     | validate username (`USERNAME_RE`) + non-empty password -> scrypt hash -> atomic rewrite; `201` + user view                                                                                                        |
| `POST`/`DELETE` with a non-admin session         | `403 forbidden` (D13: user management is admin-only)                                                                                                                                                              |
| `PATCH` with a non-admin session                 | only the **own password** may change; other targets or `disabled`/`totp` fields -> `403 forbidden`                                                                                                                |
| `POST` duplicate / invalid username / empty pw   | `409 duplicate` / `400 invalid_username` / `400 empty_password`                                                                                                                                                   |
| `PATCH` password                                 | re-hash with fresh salt; old password stops verifying immediately                                                                                                                                                 |
| Username change                                  | unsupported: the username is the primary key; no role can rename via API/page (delete + recreate instead)                                                                                                         |
| `PATCH disabled:true` on self                    | `409 self_target` (foot-gun guard; the CLI stays the escape hatch)                                                                                                                                                |
| `PATCH disabled:true` / `DELETE` last enabled    | `409 last_enabled` (lockout prevention: at least one enabled user must remain)                                                                                                                                    |
| `PATCH totp:"enable"`                            | generates a secret, persists it, and returns `{totpSecret,totpUri}` **once** (409 `totp_exists` if set)                                                                                                           |
| `PATCH totp:"disable"`                           | removes the secret (idempotent, preserves `role`)                                                                                                                                                                 |
| `DELETE` user (admin only)                       | removes from `users.yaml`; `200 {"deleted":name}`; self-delete -> `409 self_target`                                                                                                                               |
| Non-JSON body on mutations                       | `415 unsupported_media_type` (forms cannot forge a JSON content type; CSRF layer on top of SameSite=Lax)                                                                                                          |
| Body > 16 KiB / invalid JSON                     | `413 body_too_large` / `400 bad_json`                                                                                                                                                                             |
| Disabled/deleted user with live sessions         | sessions stay valid until expiry (D8: `revokeBySubject` deliberately not implemented; shown in the UI); the role is judged from the record - a deleted admin's live session loses management rights (fail-closed) |
| Token mode                                       | endpoint not registered -> `/auth` catch-all `404`; the settings page shows an "unavailable" notice                                                                                                               |
| users.yaml read/write failure                    | `503 user_store_unavailable` + error log                                                                                                                                                                          |
| `POST /auth/users/import {text}` (admin only)    | raw local file content parsed line by line as `username,password` (empty/`#` lines skipped, split at the first comma); full validation -> atomic write; `201 {created, users}`                                    |
| `POST /auth/users/import {path}` (admin only)    | reads an absolute-path `.txt` anywhere on the server (D15; relative/non-`.txt`/missing -> 404) then same flow as `{text}`                                                                                         |
| Non-POST to `/auth/users/import`                 | `405` (the GET list left with the removed imports/ sandbox mode)                                                                                                                                                  |
| Import content with invalid lines                | `400 invalid_entry` + `{failures:[{line,username,code}]}` - all-or-nothing, nothing is written (codes reuse invalid_username/empty_password/duplicate)                                                            |
| Import body: not exactly one of text/path        | `400 invalid_field` (a lone `{file}` counts as no source since the sandbox mode was removed); empty content (only blanks/comments) -> `400 no_entries`; over 100 entries -> `400 too_many_entries`                |
| Server import file missing/non-txt/over 256KiB   | `404 import_file_not_found` / `404` / `413 import_file_too_large`                                                                                                                                                 |
| Import request body > 256 KiB                    | `413 body_too_large` (raised cap only on the import route; other `/auth/users` methods stay at 16 KiB)                                                                                                            |
| `GET /auth/settings` (any session)               | `200 {sessionTtl, defaultTtl}` - the effective session TTL (settings.yaml value, or the configured default when unset)                                                                                            |
| `PATCH /auth/settings {sessionTtl}` (admin only) | integer seconds in [60, 31536000] -> atomic full write of settings.yaml; `200 {sessionTtl, defaultTtl}`; invalid value -> `400 invalid_ttl`; non-admin -> `403 forbidden`; newly issued sessions only             |
| settings.yaml read/write failure                 | `503 settings_store_unavailable` + error log (a successful PATCH self-heals a corrupted file)                                                                                                                     |
| Non-GET/PATCH to `/auth/settings`                | `405` (allow: GET, PATCH)                                                                                                                                                                                         |

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
- **D-UM-9** (D14, amended by D15): batch import lives on its own exact route
  `/auth/users/import` (POST only), admin only. Two sources: local = the
  browser reads the file with FileReader and submits the raw text as `{text}`
  (zero server filesystem exposure); server path = `{path}`, an absolute-path
  `.txt` anywhere on the host (D15: D14's fixed `<usersDir>/imports/` sandbox
  with its `{file}` source and GET listing was removed once the owner accepted
  admins reading any `.txt` - still admin-only, `.txt`-suffixed, size capped,
  every invalid form collapsed into 404). The server parses `username,password`
  lines for both sources (line-numbered, machine-readable failures), writes
  all-or-nothing atomically; caps are 256 KiB / 100 entries (total scrypt cost
  stays in seconds). Imported users are always regular users (roles are
  CLI-only, D13).
- **D-UM-10** (D16): the login timeout (session TTL) is configurable at
  runtime. The value lives in a `settings.yaml` co-located with users.yaml
  (strict zod schema, atomic 0600 write, same discipline as writeUsersFile;
  zero new config - it follows a `usersFile` override). A new exact route
  `/auth/settings` (password mode only): GET answers any session with
  `{sessionTtl, defaultTtl}`; PATCH is admin-only, integer seconds in
  [60, 31536000], full-file write (a successful write self-heals a corrupted
  file). `IssueSessionDeps.sessionTtl` changes from a static number to a
  per-issue resolver: the login path re-reads settings.yaml and falls back to
  the plugin config when the file is missing/unreadable (read errors are
  logged, not fatal - the TTL is not an auth boundary). Semantics mirror the
  D-UM-5 footnote: only new sessions are affected; issued sessions expire on
  their original schedule. The page shows the current value near the top
  (read-only for non-admins); admins edit it in whole hours.

## 4. Deployment notes

- Zero new configuration; password mode mounts the endpoint automatically,
  token mode does not register it at all.
- `settings.yaml` (D16) sits next to users.yaml and holds the runtime session
  TTL; hand-edits are fine (it is an operator file like users.yaml) - invalid
  content makes the admin API's GET answer 503 while logins fall back to the
  configured default with an error log.
- No new dependencies; `users.yaml` gains a **backwards-compatible optional
  field** `role` (existing files: every user is a regular user). The CLI and
  the API operate on the same file with the same atomic write
  (`writeUsersFile`).
- **Upgrade migration**: after upgrading to a release with D13, existing
  users are all non-admin and management mutations return 403 - grant admin
  via the CLI first: `dsh-auth user admin enable <name>` (or create one with
  `dsh-auth user add <name> --password-stdin --admin`). `dsh-auth user list`
  marks roles as `(admin)` / `(admin, disabled)`.
- **Server-side import**: the "Server path" mode (D15) imports any
  absolute-path `.txt` on the host directly - no staging directory involved;
  keep the file's permissions on par with users.yaml (600/700).
- TOTP enable via the page prints the base32 secret + otpauth URI once in the
  response; the admin copies it into the authenticator manually (no QR image,
  keeping the bundle self-contained).
- Audit: add/update/delete write `user <name> added|updated|deleted via
/auth/users` info logs; imports write `imported <n> users via
/auth/users/import (...)`; timeout changes write `session TTL updated to
<n>s via /auth/settings`; secrets/hashes/passwords are never logged.

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
- Import: `src/features/password/user-admin-import.test.ts` (parseImportText
  pure line-level cases + POST text/path success, all-or-nothing per-line
  details, duplicates, no_entries/too_many_entries/invalid_field (incl. a lone
  `{file}`), 404/413; path mode also covers relative/non-`.txt`/missing 404s
  and the non-admin 403; non-POST methods answer 405).
- Integration: `src/integration.users.test.ts` and
  `integration.users-import.test.ts` - real stack (storage-json +
  storage-domain + WebServer + plugin; shared base
  `integration-users-helpers.ts`): unauthenticated 401, list with
  `current`/`admin` markers, create -> real sign-in, duplicate 409,
  self-target 409, delete persistence, 405/415, the non-admin 403 matrix;
  import: real sign-in after a text import, absolute-path import with real
  sign-in + non-`.txt`/relative 404s, non-admin 403, GET 405.
- Client: `src/client/users-section.test.tsx` (states + mutations + TOTP
  reveal), `users-section.nonadmin.test.tsx` (degraded non-admin UI),
  `user-import.test.tsx` (panel visibility, local raw-text upload,
  absolute-path import without any file listing, localized per-line failures);
  `logout-action.test.tsx`
  covers the section registration and merged dictionaries.
- CLI/file: `src/cli.test.ts` and `cli.admin.test.ts` (`--admin`,
  `user admin enable/disable`, list role markers);
  `src/shared/users-file.test.ts` (role parsing / rejecting invalid values /
  write-read round-trip).
- Login timeout (D16): `src/features/password/session-settings-endpoints.test.ts`
  (401/503, GET default/file-value/corrupted-503, non-admin 403, PATCH
  round-trip + audit log, the invalid_ttl matrix, boundary values, corrupt
  file self-heal, 415/413/400, write-failure 503, 405);
  `src/shared/settings-file.test.ts` (missing flag, write-read round-trip,
  0600, schema rejections, directory creation); integration
  `src/integration.settings.test.ts` (real stack: unauthenticated 401,
  configured default, non-admin 403, PATCH persists and GET reflects, fresh
  logins carry the new Max-Age, 405); client panel cases in
  `users-section.test.tsx` (display/save/local validation) and
  `users-section.nonadmin.test.tsx` (read-only).

## 6. Change log

| commit        | content                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| 5508640       | feat: user management settings page + `/auth/users` API                                                        |
| dbbd507       | feat: admin role + permission matrix (D13), CLI role management, role-aware page                               |
| 28aeba3       | feat: txt batch import (D14), local/server dual file browsing, `/auth/users/import` sandbox                    |
| 1d302b7       | feat: batch import switches to an arbitrary absolute server path `{path}` (D15); imports/ sandbox mode removed |
| (this change) | feat: runtime-configurable login timeout (D16): page setting + `/auth/settings` API                            |
