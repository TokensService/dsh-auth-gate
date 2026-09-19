# Batch import switches to arbitrary absolute server paths ({path}, amending D14) (2026-09-14)

## Decision

The server-side file source of `POST /auth/users/import` changes from D14's
imports/ sandbox (`{file}` plus a GET directory listing) to `{path}`: any
absolute-path `.txt` file on the server. The sandbox mode (the `{file}` source
and `GET /auth/users/import`) is removed along the way, leaving the endpoint
POST-only. Kept guardrails: admin only; non-absolute paths, NUL bytes and
non-`.txt` suffixes all answer `404 import_file_not_found` (no oracle for
"which paths are valid"); over 256 KiB -> 413; other read failures -> 503; the
audit log records the exact path read. The page keeps just two modes: "Local
file" and "Server path". This entry amends two D14 decisions: the rejection of
free-form server paths and the fixed imports/ sandbox.

## Context

D14 pinned server-side sources to the `<usersDir>/imports/` sandbox to avoid
arbitrary file reads from the web surface. In day-to-day operations that became
friction: the file is already on the host yet must be copied into imports/
first. At the owner's request `{path}` absolute paths were opened up (the owner
explicitly accepted that an admin session may read any `.txt`). Once opened,
the sandbox mode became a redundant entry point - two server-side sources with
overlapping semantics - so the owner chose to keep only the more general
`{path}` and delete the sandbox together with the directory listing, narrowing
the endpoint and the page in step. The readable surface stays bounded by three
constraints: admin only (D13's permission matrix is unchanged; privilege
escalation still requires shell access), the `.txt` suffix (which naturally
excludes /etc/passwd, users.yaml and app configs), and the 256 KiB cap.

## Alternatives Considered

- **Keep the imports/ sandbox alongside {path}** - rejected: two server-side
  sources with overlapping semantics, one more mode branch in both the page and
  the endpoint; `{path}` fully covers the sandbox (a file inside imports/ can
  equally be referenced by absolute path).
- **A server filesystem browser (directory-listing API plus navigate UI)** -
  rejected: enumerating the whole filesystem is a larger exposure than reading
  one known path, and the endpoint/UI complexity jumps an order of magnitude;
  in ops scenarios the admin knows where the file lives.
- **Allow any extension** - rejected: the `.txt` suffix is a cheap class fence
  that keeps passwd/shadow/yaml-style targets outside the endpoint's semantics
  at zero cost to legitimate imports.
- **Answer invalid path forms with 400 invalid_field instead of 404** -
  rejected: invalid forms and missing files stay indistinguishable, so the
  endpoint cannot serve as a path-validity probe.

## Why

`{path}` covers every server-side import scenario with the fewest entry points:
it keeps the validation, caps and atomic write of the old `{file}` flow while
the sandbox directory, basename whitelist and GET listing are deleted, making
the endpoint smaller. The readable surface is bounded at admin + .txt + 256 KiB
with every read audit-logged. The local `{text}` mode is unaffected, and there
is no migration cost - an existing imports/ directory simply sits unused on
disk; nothing reads it anymore.
