# Never-expiring sessions by default with deterministic finite expiry (2026-09-19)

## Decision

`sessionTtl` defaults to `0`, meaning the application session never expires.
The session row stores `expiresAt: 0` as that sentinel and neither validation
nor pruning treats it as expired. Login cookies still need a finite browser
lifetime, so a non-expiring application session uses `Max-Age=2147483647`,
while logout continues to use `Max-Age=0` and revokes the server-side row.

Finite timeouts remain supported. The settings API accepts `0` or an integer
in [60, 31536000], and the User Management page offers an explicit "Never
expires" choice alongside its whole-hour input. `/auth/status` reports the
finite session's absolute expiry as epoch milliseconds in `expiresAt`, or
`null` for a non-expiring or unauthenticated session. It also reports
`serverTime`, so the client derives a relative remaining duration without
depending on the browser wall clock. The client probes status immediately,
arms a local timer for a finite expiry, permits only the latest-started probe
to apply a response, and retains periodic, focus, and visibility probes for
revocation and cross-tab changes.

Existing `settings.yaml` values remain explicit policy and are not rewritten
on upgrade. Any TTL change still affects newly issued sessions only.

## Context

The previous seven-day default did not match deployments that expect a login
to remain valid until manual logout. Runtime timeout settings were working for
new sessions, but existing sessions kept the lifetime captured at issue time,
which made a setting change appear ineffective.

There was a second, visible problem for finite sessions: dsh web is a
long-lived SPA. Once its server-side session expired, the already rendered
page could remain on screen until a later request or status probe noticed.
Polling alone also makes the redirect depend on timer scheduling and a
successful network response after the deadline.

## Alternatives Considered

- **Keep the seven-day default** - rejected because it contradicts the desired
  default policy and forces every deployment to create an override.
- **Use only the existing 30-second status polling** - rejected because an
  expired SPA may remain visible past the deadline, especially when the tab is
  throttled or the expiry-time probe fails.
- **Use `Max-Age=0` for never-expiring sessions** - rejected because browsers
  interpret it as immediate cookie deletion. Application infinity and cookie
  deletion need separate representations.
- **Apply setting changes to already issued sessions** - rejected because it
  would silently extend or shorten credentials whose expiry was fixed when
  issued. Operators can revoke or sign out those sessions explicitly.

## Why

The zero sentinel adds no storage migration because the persisted schema
already accepts nonnegative timestamps. A large portable cookie lifetime
keeps browser storage practical while the server remains authoritative; a
browser may still clear or clamp persistent cookies according to its own
policy. Exposing an absolute expiry plus the server time lets the browser leave
the stale SPA at the intended deadline without trusting its wall clock or a
later network response. Response ordering prevents any older in-flight probe
from redirecting or replacing newer session state. Periodic status probes remain useful for
revocation, while transient probe failures do not cause false logout or cancel
the already armed deadline.
