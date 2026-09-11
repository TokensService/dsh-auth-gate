# /auth/status exposes the login username, always null in token mode

## Decision

`GET /auth/status` gains a `username` field: the session subject in password mode
(i.e. the login username), `null` when unauthenticated, and always `null` in token
mode. The client half renders the username above the Settings "Sign out" button
(reusing the same status probe; the line is not rendered in token mode).

## Context

dsh web needs to display the signed-in username, but the plugin only exposed an
`authenticated` boolean. The session row's subject already is the username in
password mode (P14), while in token mode it is the constant audit placeholder
"token". Constraints: the response must be purely additive (older clients read only
`authenticated`/`logoutOrder`); no new route surface; the field must never present
a placeholder as if it were a user.

## Alternatives Considered

- **A dedicated `/auth/whoami` endpoint** - duplicates the session lookup, adds a
  route/disposer surface, and costs the client a second request.
- **Returning the subject ("token") in token mode** - the UI would display an audit
  placeholder as a username, misleading; consumers would have to special-case it.
- **Omitting `username` instead of null** - three states (anonymous / token mode /
  named user) become indistinguishable without cross-reading `authenticated`.

## Why

An additive field breaks nothing: the client already fetches the status probe on
mount, so the username arrives in the same frame with zero extra requests. The
`string | null` shape is self-describing (null = no displayable identity), and
returning null in token mode is honest semantics rather than placeholder leakage.
