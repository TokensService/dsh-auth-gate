# txt batch user import: local/server dual mode with a fixed imports/ sandbox (2026-09-14)

## Decision

The user management page gains batch import: `POST /auth/users/import` accepts
either `{text}` (raw local file content, read in the browser via FileReader and
submitted with the request) or `{file}` (a server-side file name). Server-file
mode only reads `.txt` inside `<users.yaml dir>/imports/` - a filename whitelist
(`SERVER_FILE_RE`) rejects any path separator - and `GET /auth/users/import`
lists the candidates in that directory. Lines are parsed as `username,password`
(split at the first comma; empty lines and `#` comments skipped), fully
validated, reported by line number on failure, and written atomically
(all-or-nothing). Admin only; request body and server file are capped at
256 KiB, at most 100 entries per import (scrypt cost is linear). Imported
users are always regular users.

## Context

Operating the gate sometimes means onboarding a whole team at once; adding
users one by one on the page or via SSH + CLI is tedious. The requirement asks
for "batch add from txt, one `username,password` per line" with "both
server-side and local file browsing". D13 just confined user management to
admins, so imports must follow the same permission model without opening
"the web surface reads arbitrary server files".

## Alternatives Considered

- **Free-form server path input (absolute path text field)** - rejected: that
  is arbitrary file read from the web (`/etc/passwd`, other apps' configs),
  breaking D13's "privilege escalation requires shell" boundary. A fixed
  `imports/` sandbox plus a basename whitelist pins the readable surface.
- **multipart upload (streaming parse of req)** - rejected: all existing
  endpoints are JSON-only (the CSRF argument of D-UM-2); reading the file in
  the browser and sending the text as JSON keeps the same-origin policy
  unchanged, needs zero client-side parsing code, and keeps line numbers
  identical across both modes.
- **Skip bad lines and import the rest (best-effort)** - rejected: half-done
  states are hard to explain (which entries made it?); all-or-nothing with
  per-line details matches the atomic write semantics of `writeUsersFile` -
  fix the file and re-upload.
- **Optional role/disabled columns in the txt** - rejected: roles are CLI-only
  (D13); disabling is covered by single-user PATCH, keeping the format a
  minimal two columns.
- **Client parses entries into an array before upload** - rejected: line
  numbers would no longer match the original file (skipped/comment lines);
  server-side parsing is the single source of truth.

## Why

Local mode exposes zero server filesystem; server mode trades a fixed
directory for the convenience of importing files already on the host, without
any traversal surface. All-or-nothing with line-numbered failures is
machine-readable, fixable, and re-uploadable. The 100-entry / 256 KiB caps
keep total scrypt cost in the seconds range (libuv thread pool parallelism),
so an import cannot stall the gateway.
