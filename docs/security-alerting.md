# Security Observability: Logging, Sentry, and Alerting

Added in Phase 10 after an audit found the backend had no error tracking and
no logging of security-relevant events at all — a credential-stuffing run, a
wave of 403s, or a spike in rate-limit hits would have been invisible until a
user complained. This doc covers what exists now and, critically, the Sentry
alert rule configuration — **Sentry alert rules are not code**, so nothing
else in this repo shows they exist; if the Sentry project is ever recreated,
this doc is what lets you reproduce them exactly.

---

## What gets captured, and where

### 1. Errors and exceptions → Sentry

`backend/app/core/sentry.py` initializes the Sentry SDK from `main.py`,
before the `FastAPI` app is constructed, so every request the app ever
handles is instrumented. It no-ops completely when `SENTRY_DSN` is unset
(the default) — local dev and CI need no Sentry account.

The frontend has the matching `@sentry/nextjs` integration (scaffolded via
`npx @sentry/wizard`), gated the same way by `NEXT_PUBLIC_SENTRY_DSN`.

Sentry DSNs are designed to be write-only and rate-limited per project by
Sentry itself, so exposing the frontend one via `NEXT_PUBLIC_` is the
standard, expected pattern — not a secret leak the way `SECRET_KEY` or
`MAPS_API_KEY` would be.

### 2. Structured security events → stdout logs (and some → Sentry)

`backend/app/core/security_log.py` is a thin wrapper around the stdlib
`logging` module, using a dedicated `security` logger name so these events
can be filtered independently of general application logs. Every event
carries a fixed shape: `{event, ip, user_id, path, timestamp}`.

`backend/app/core/logging_config.py` configures the root logger once, at
`main.py` import time:
- **production**: one JSON object per line (so a log aggregator can query on
  `event`/`ip`/`user_id` as structured fields, not free text).
- **anything else** (local dev, CI): plain human-readable lines.

Events currently emitted:

| Event | Where | Also sent to Sentry? |
|---|---|---|
| `auth.login_failed` | `app/api/auth.py`, on bad email/password in `POST /auth/login` | Yes — `capture_message` at `warning` level, tagged `event` + `ip`. This is what the alert rule below watches. |
| `auth.unauthorized` | `app/core/deps.py`'s `get_current_user`, on any 401 (missing/invalid/expired access token) | No — high-volume/low-signal (every expired tab produces one); logged for local debugging/volume trends only. |
| `auth.forbidden` | `app/core/security_log.py`'s `log_forbidden` helper — not currently called by any route | No — see note below. |
| `rate_limit.exceeded` | `app/main.py`'s wrapped `RateLimitExceeded` handler, on any 429 | No — same reasoning as `auth.unauthorized`; a legitimate user bumping a limit isn't a security signal on its own. |

**Why no route currently raises a bare 403**: every ownership check in this
codebase (see `docs/prd/phase-10-security-hardening-round-2.md`'s
authorization-audit appendix) returns `404`, not `403`, when a user requests
a resource they don't own — this avoids confirming to a non-owner that a
given trip ID even exists. `log_forbidden` exists as a ready hook so that if
a future endpoint does need a real 403 (e.g. a shared-but-read-only
resource where existence is intentionally not secret), it's covered by
security logging from day one instead of a future audit finding the gap
again.

**Why login failures deliberately don't log which check failed**: the log
event and the client-facing HTTP error both say "invalid credentials" for
both "unknown email" and "wrong password". That distinction is exactly what
a credential-stuffing attacker would want to learn from logs (or timing) if
they were ever exposed — so it's never recorded, not even server-side.

---

## The alert: 20+ failed logins from one IP in 5 minutes

Configured directly in the Sentry project's **Alerts** UI (not as code) — a
custom metric alert:

| Field | Value |
|---|---|
| Alert type | Number of events |
| Event filter | `message:"Failed login attempt*"` and `event:auth.login_failed` (matches the `capture_message` call in `log_login_failed`) |
| Aggregation | Count, **grouped by `ip` tag** (so the threshold applies per-IP, not app-wide — an app-wide count of 20 failed logins across many different users in 5 minutes is normal background noise, not an attack) |
| Threshold | ≥ 20 events |
| Time window | 5 minutes |
| Action | Notify — email (or whichever channel is already configured on the Sentry project; Slack/PagerDuty work identically if added later) |

**To recreate this rule** if the Sentry project is ever rebuilt: Sentry
project → Alerts → Create Alert → "Number of Events" → filter by the
`event` tag equal to `auth.login_failed` → set "group by" to the `ip` tag →
threshold `>= 20` in `5m` → choose a notification action → save.

### Why per-IP grouping, not a flat count

A flat "20 failed logins across the whole app in 5 minutes" threshold would
either be too noisy (any Tuesday with a few users mistyping passwords trips
it) or too loose (a targeted attack against one account from one IP could
sit under it if the app has enough unrelated background failures). Grouping
by IP means the alert fires specifically on the shape of an actual
credential-stuffing run: many attempts, concentrated from one source, in a
short window.

### Known limitation: distributed/IP-rotating attacks

An attacker rotating source IPs (botnet, rotating proxy pool) can stay under
both the per-IP rate limit (`docs/rate-limiting-plan.md`, 10/hour/IP on
`/auth/login`) and this per-IP alert threshold simultaneously, since each
individual IP never crosses either ceiling. Detecting that pattern would
require aggregating failed logins **by targeted email** rather than by
source IP, which isn't implemented here — flagged as a follow-up, not fixed
in Phase 10, since it's a materially different (and more complex, e.g.
needs safeguards against becoming an account-enumeration or self-DoS vector)
detection strategy from what this phase scoped.

---

## Verifying it works

1. **Sentry error capture**: trigger any unhandled exception in a
   non-production environment with `SENTRY_DSN` set to a test project's DSN;
   confirm it appears in Sentry within about a minute, tagged with the
   correct `environment`.
2. **Structured security logs**: hit `POST /auth/login` with a wrong
   password; confirm one `security` logger line appears in stdout (JSON in
   production, plain text otherwise) with `event=auth.login_failed` and the
   correct source IP.
3. **Alert firing**: script 20+ failed login attempts against a test/staging
   environment from one machine within 5 minutes; confirm the Sentry alert
   fires and the configured notification arrives. Confirm normal-volume
   traffic (a handful of real logins, an occasional expired-tab 401) does
   **not** trigger it.

See also: `docs/prd/phase-10-security-hardening-round-2.md` (Part B — the
PRD this doc was written to satisfy), `docs/rate-limiting-plan.md` (the
rate-limit layer that works alongside this alerting, not instead of it).
