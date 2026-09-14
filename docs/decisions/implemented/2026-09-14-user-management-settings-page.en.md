# User management via settings page + session-guarded /auth/users API (2026-09-14)

## Decision

Add a "User Management" page to the dsh settings modal (`settings.section`
slot, id `auth-users`, order 30) backed by a new exact route
`GET|POST|PATCH|DELETE /auth/users`. The endpoint sits under the `/auth` gate
whitelist and therefore validates the session itself (cookie or Bearer session
token). Mutations accept only `application/json`. The server refuses to
disable/delete the signed-in user and to remove the last enabled user.

## Context

User administration required shell access (`dsh-auth user` CLI); the dsh RPC
channel pins privileged methods to loopback, so nothing browser-side could
manage `users.yaml` on a public deployment. The plugin already owns a
same-origin session-carrying channel (`/auth/*`) and a client half mounted in
the settings modal, making a self-served admin page feasible without upstream
changes.

## Alternatives Considered

- **dsh RPC channel (`settings.*`/custom method)** - rejected: privileged
  methods are loopback-only (`PRIVILEGED_METHODS`); a public deployment gets
  403 regardless of authentication.
- **Register the endpoint outside `/auth` so the gate guards it** - rejected:
  the gate's whitelist would need a new concept (public vs session-required
  auth routes); keeping everything under `/auth` with an endpoint-local
  session check is one small helper, consistent with `/auth/status`.
- **Allow self-disable/self-delete like the CLI** - rejected: the UI is a
  foot-gun surface; lockouts would need SSH anyway (the CLI stays the escape
  hatch).
- **Implement `revokeBySubject` so disable/delete kicks live sessions** -
  rejected: D8 already re-evaluated and deferred this (`TODO(auth-m5)`); the
  page documents the semantics instead of reopening the decision.
- **Configurable section order (like D4 `logoutOrder`)** - rejected: the
  section band is sparsely populated (built-ins 0-20, third-party ~100); a
  fixed order 30 has no demonstrated collision risk.

## Why

The single-gate model trusts every authenticated session, so any signed-in
admin may manage users; the remaining risks are CSRF (answered by JSON-only
mutations on top of SameSite=Lax) and operator mistakes (answered by
server-side self/last-enabled guards). Reusing the `/auth` channel and the
`settings.section` slot keeps the change free of upstream coupling, new
dependencies, and new configuration.
