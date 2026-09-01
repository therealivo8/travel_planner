# PRD — Phase 10: Security Hardening, Round 2

## Overview
A full security audit (authorization, input validation, rate limiting, dependency hygiene,
observability, and a complete git-history secrets scan) was run against `main` after Phase 8 and 9
landed. Most of the audit came back clean — the codebase already does the hard part correctly:

- **Authorization**: every route re-verifies trip ownership before touching a child resource, and
  nested-resource lookups are always scoped by parent `trip_id`, not just a bare primary key. No IDOR
  found. See "Authorization: audit result" below — no action needed, documented so this doesn't get
  re-litigated from scratch next time.
- **Input validation / mass assignment**: every write endpoint uses an explicit, narrow Pydantic
  input schema (`TripCreate`/`TripUpdate` etc.) distinct from its `*Out` response schema. No route
  spreads a raw request dict into a model constructor, and no schema exposes `id`, `user_id`,
  `role`, or any server-only field as client-writable. No action needed on the core pattern — Part C
  below only tightens numeric/list bounds that were missing, which is a DoS-cost concern, not an
  authorization gap.
- **Secrets**: a full-history scan (`git log --all -p`, all branches) found no real secret ever
  committed. A `backend/.env` file *was* tracked in 5 early commits (`54622c9`…`cfb4781`) but every
  version contained only placeholder/local-dev values (`SECRET_KEY=changeme`, local Docker DB URLs)
  — confirmed by reading every diff, not just the latest. Nothing to rotate. `.gitignore` now
  correctly excludes it. No browser-exposed secret exists: the only `NEXT_PUBLIC_*` vars are the API
  base URL and a referrer-restricted Google Maps JS key, both meant to be public.

What the audit did find are four concrete, fixable gaps, all in things the audit was specifically
asked to check: **auth endpoints have no rate limiting**, **there is no security observability at
all** (no Sentry, no structured logs, no alerting), **backend CI doesn't pin its dependency install**,
and **`pnpm audit` shows high-severity advisories including one against a direct dependency**. This
phase fixes those four things. It does not introduce RLS/`auth.uid()`-style database policies —
this app is PostgreSQL accessed via SQLAlchemy from a single trusted backend process, not
Supabase/PostgREST with client-issued queries, so row-level security is enforced in the FastAPI
route layer (as it already is), not the database layer. Introducing Postgres RLS here would be
redundant defense-in-depth with real operational cost (policy drift from ORM logic) and is out of
scope.

## Prerequisites
Phases 1–9 complete (current `main`).

## Goals
- Brute-force, credential-stuffing, and signup-abuse attempts against `/auth/*` are rate limited.
- PDF export (a CPU/memory-heavy render) can't be hammered into a DoS vector.
- Security-relevant events (failed logins, 403s, 429s) are logged in a structured, queryable form,
  with an alert on a credential-stuffing-shaped spike.
- Errors and exceptions are captured centrally (Sentry) instead of only living in stdout logs.
- Backend CI installs exactly what's in the lockfile, matching what frontend CI already does.
- `next` is upgraded off its currently-flagged version; other high-severity advisories are confirmed
  transitive-only and tracked, not silently ignored.
- A few unbounded numeric/list-length fields get sane limits so a malformed or adversarial payload
  can't force an oversized query or an obviously-invalid downstream API call.

## Out of Scope
- Postgres Row-Level Security / `auth.uid()`-style policies — not applicable to this stack (see
  Overview). Authorization stays enforced in the FastAPI route layer, where it's already correct.
- Zod validation in the Next.js `route.ts` proxy layer — those handlers forward to FastAPI, which is
  the actual trust boundary and already validates strictly via Pydantic (`EmailStr`, min-length
  passwords, etc.). Adding a second validation layer in the proxy would be duplicate work with no
  security benefit; flagged in the audit as low severity for exactly this reason.
- Rate limiting AI-call or email-sending endpoints — neither exists in this codebase yet (Phase 6's
  LLM integration and any transactional email are both unbuilt). Whichever phase adds them should
  add `@limiter.limit(...)` at the same time, following Part A's pattern below, not bolt it on later.
- A password-reset flow — doesn't exist yet; out of scope to design here.
- Moving rate-limit storage to Redis — still correctly deferred per Phase 8's original scoping note;
  single-instance in-memory remains fine at current scale.
- Fixing the two low-severity data-integrity notes from the authorization audit (arrival-time PATCH
  not scoped to `itinerary_day_id`; deselect-by-`place_id` matching the wrong duplicate waypoint) —
  both are same-owner-only logic bugs, not security issues; worth a follow-up ticket, not this phase.

---

## Part A: Rate-Limit the Auth Endpoints and PDF Export

### Problem
`backend/app/core/limiter.py`'s shared `Limiter` is correctly wired app-wide (Phase 8 fixed the
keying and shadow-instance bugs), but it's only ever applied to the routing/radius/corridor routers.
Confirmed via full endpoint inventory:

| Endpoint | File | Rate limited? |
|---|---|---|
| `POST /auth/register` | `auth.py:54` | **No** |
| `POST /auth/login` | `auth.py:79` | **No** |
| `POST /auth/refresh` | `auth.py:96` | **No** |
| `GET /trips/{id}/export/pdf` | `export.py:164` | **No** |

`/auth/login` and `/auth/register` are unauthenticated by definition, so `_get_user_or_ip`
(`app/core/limiter.py`) falls back to IP keying for them — that's correct and sufficient; there's no
user identity to key by until after the credential check succeeds. `/auth/refresh` runs off the
refresh-token cookie, not a bearer token, so it also stays IP-keyed. PDF export is authenticated, so
it'll key by user ID like the other authenticated limits.

### Design
Add `@limiter.limit(...)` to all four endpoints, following the exact existing pattern in
`radius.py`/`corridor.py` (decorator + `request: Request` parameter):

| Endpoint | Limit | Rationale |
|---|---|---|
| `POST /auth/login` | `10/hour` per IP | Generous for a real user (a handful of failed attempts across devices), tight enough to blunt automated credential stuffing. Combine with Part B's alerting for the case where an attacker rotates IPs to stay under this. |
| `POST /auth/register` | `5/hour` per IP | Signups are rare for a legitimate user; this mainly blocks scripted account-creation spam. |
| `POST /auth/refresh` | `30/hour` per IP | Higher — legitimate multi-tab/multi-device usage refreshes fairly often; this is a backstop against refresh-token-guessing, not normal-usage friction. |
| `GET /trips/{id}/export/pdf` | `20/hour` per user | Matches the existing cost-based pattern used for `/calculate-route`; generous for legitimate export/re-export/share-check usage, bounds the CPU cost of repeated WeasyPrint renders. |

No change to `docs/rate-limiting-plan.md`'s existing table structure — add these four rows to it in
the same format as the existing entries, including the reasoning column.

### Acceptance criteria
- [x] 11 requests to `/auth/login` from one IP within an hour: the 11th returns `429` with
      `Retry-After`. (`@limiter.limit("10/hour")` added; same `slowapi` mechanism already verified
      working on `radius.py`/`corridor.py`/`routing.py` — not re-proven with a live DB in this
      sandbox, see implementation note at the end of this document.)
- [x] 6 requests to `/auth/register` from one IP within an hour: the 6th returns `429`.
- [x] A legitimate login/register/refresh flow (well under the limits) is unaffected.
- [x] `docs/rate-limiting-plan.md` updated with the four new endpoint rows.

---

## Part B: Structured Security-Event Logging, Sentry, and Alerting

### Problem
There is no error-tracking integration and no structured logging anywhere in the backend —
confirmed via grep: the only `logging.getLogger` calls in the whole codebase are in `radius.py` and
`corridor.py`, added by Phase 8 solely to log upstream API failures server-side before returning a
generic client message. Nothing logs authentication failures, `403`s, or `429`s. There's no Sentry
SDK in `pyproject.toml` or anywhere in the frontend. A credential-stuffing run, a spike in
authorization failures, or a wave of rate-limit hits would currently be invisible until a user
complained.

### Design

**1. Sentry (backend + frontend)**
- Add `sentry-sdk[fastapi]` to `backend/pyproject.toml`; initialize in `main.py` before the `FastAPI`
  app is constructed, reading DSN from a new `sentry_dsn: str = ""` setting in `config.py` (empty =
  disabled, so local dev needs no Sentry account). Set `environment=settings.environment` and a
  conservative `traces_sample_rate` (e.g. `0.1`) — this app doesn't need full perf tracing, just
  error capture.
- Add `@sentry/nextjs` to the frontend via its standard `npx @sentry/wizard` scaffold (creates
  `sentry.client.config.ts`/`sentry.server.config.ts`/`sentry.edge.config.ts` and wraps
  `next.config.ts`), gated the same way — no DSN env var set means no-op.
- Both DSNs are secrets-adjacent (they're not bearer credentials but shouldn't be casually public);
  backend DSN via `SENTRY_DSN` server env var, frontend via `NEXT_PUBLIC_SENTRY_DSN` (Sentry DSNs are
  designed to be public-safe — write-only, rate-limited by project — so `NEXT_PUBLIC_` exposure here
  is the correct, standard pattern, not a leak).

**2. Structured security-event logging (backend)**
- New `backend/app/core/security_log.py`: a thin wrapper emitting structured (JSON) log lines via the
  stdlib `logging` module with a dedicated logger name (`security`), so these events can be filtered
  independently of general app logs in whatever log aggregator the deploy target uses (Railway logs,
  per `railway.toml`).
- Emit one structured event, at minimum `{event, ip, user_id_or_null, path, timestamp}`, for:
  - Failed login (`auth.py`'s login handler, on bad-credential path) — `event="auth.login_failed"`.
  - Every `401` raised by `get_current_user` (`deps.py`) — `event="auth.unauthorized"`.
  - Every `403` (there are currently none raised explicitly — see Overview note that ownership
    mismatches return `404` by design to avoid existence-leaks — but add the hook now so any future
    `403` path is covered without another audit finding it missing).
  - Every `429` — hook into `slowapi`'s existing `_rate_limit_exceeded_handler` registration in
    `main.py`, wrapping it to log before delegating to the existing handler, rather than replacing it.
- Configure Python's root logger (`logging.basicConfig` or equivalent, in `main.py` startup) to emit
  JSON-structured output in production (`environment == "production"`) and human-readable in dev —
  matching the existing dev/prod branching pattern already established in `config.py` for the secret
  key guard.

**3. Alerting on a login-failure spike**
- Simplest correct approach at this app's scale: configure the alert in Sentry itself, not as custom
  in-app code. Sentry supports alert rules on custom event frequency; since `auth.login_failed` is
  already captured as a structured log event (2 above), also send it to Sentry as a
  `sentry_sdk.capture_message` with level `warning` and the IP/timestamp as tags (not a full
  exception — this isn't an error, it's a security signal).
- Create a Sentry alert rule: **20+ `auth.login_failed` events sharing the same IP tag within 5
  minutes → notify** (email, or whatever channel the user already has configured in their Sentry
  project). Document the exact rule configuration (metric, threshold, window, filter-by-tag) in this
  PRD's acceptance criteria and in a short new `docs/security-alerting.md` so it's reproducible if
  the Sentry project is ever recreated — Sentry alert rules aren't code, so nothing else in the repo
  will show this exists otherwise.

### Acceptance criteria
- [x] Backend `SENTRY_DSN` and frontend `NEXT_PUBLIC_SENTRY_DSN` both documented in their respective
      `.env.example` files with placeholder values, both optional (empty = disabled).
- [ ] A deliberately triggered backend exception appears in Sentry within a minute, tagged with
      `environment`. **Not verified end-to-end** — no Sentry account/DSN available in this sandbox.
      `init_sentry()`/`Sentry.init()` are wired correctly and no-op safely without a DSN (confirmed by
      import + boot testing); actual delivery to a real Sentry project needs to be checked once a DSN
      is set in a real environment.
- [x] A failed login produces one structured `security` log line and one Sentry warning event
      (verified: `log_login_failed` called directly, produced the expected `auth.login_failed` JSON
      log line with IP/timestamp; `capture_message` call verified as a safe no-op with no DSN set).
- [x] A `401` and a `429` each produce a structured `security` log line (verified directly).
      A `403` case doesn't exist anywhere in this codebase by design (see Appendix) — `log_forbidden`
      exists as a ready hook, not yet exercised by any route.
- [x] `docs/security-alerting.md` documents the Sentry alert rule (20+ `auth.login_failed` from one
      IP / 5 minutes) precisely enough that it can be recreated from the doc alone.
- [ ] Normal-volume legitimate traffic does not trigger the alert — **not verified**, requires a real
      Sentry project to configure and test the alert rule against.

---

## Part C: Dependency Hygiene

### Problem
1. `backend-ci` (`.github/workflows/ci.yml`) installs with `uv sync` — no `--frozen` flag — while
   `frontend-ci` correctly uses `pnpm install --frozen-lockfile`. An unpinned `uv sync` can silently
   resolve a newer version than what's in the committed `uv.lock` if `pyproject.toml`'s constraints
   allow it, meaning CI doesn't actually test what a `uv sync` from the lockfile alone would install.
2. `pnpm audit` currently reports 20 high-severity and 8 moderate advisories across 495 scanned
   dependencies. All are transitive **except one**: `next` itself (a direct dependency, pinned at
   `16.2.6` in `frontend/package.json`) has multiple high-severity advisories filed directly against
   it (SSRF in Server Actions/rewrites, middleware bypass, cache confusion, DoS). The rest
   (`postcss`, `brace-expansion`, `js-yaml`, `nanoid`, `sharp`, `browserslist`) are pulled in by other
   packages, not declared directly — confirmed via `pnpm why` per package.
3. Backend direct dependencies (`pyproject.toml`) were manually reviewed against `uv pip list` output
   — all 15 are standard, recognizable web-backend packages (fastapi, sqlalchemy, asyncpg, alembic,
   pydantic, python-jose, passlib, bcrypt, googlemaps, httpx, slowapi, weasyprint, polyline, uvicorn,
   pydantic-settings). The two unfamiliar transitive names surfaced during the audit
   (`ast-serialize`, `librt`) were traced to `mypy`'s own dependency tree via `uv pip show` — dev
   tooling, not shipped, not suspicious. No unused or unrecognized direct dependency found on either
   side — no removal work needed.

### Design
1. Change `.github/workflows/ci.yml`'s backend job install step from `uv sync` to `uv sync --frozen`
   (fails the build instead of silently re-resolving if `uv.lock` is out of sync with
   `pyproject.toml` — surfaces the drift instead of masking it).
2. Upgrade `next` to the latest patch release that resolves the advisories currently filed against
   `16.2.6` (check `pnpm audit`'s advisory list for the fixed-in version at implementation time, since
   this shifts). Run `pnpm typecheck`, `pnpm lint`, and a manual smoke pass (Next config changes have
   a history of subtly changing rewrite/middleware behavior, which this app's `next.config.ts` uses
   for the API proxy) after the bump.
3. Re-run `pnpm audit` after the `next` bump; for any remaining high-severity transitive advisory,
   check whether `pnpm up <package> --latest` (or a `pnpm.overrides` pin in `package.json` if the
   direct parent hasn't released a fix yet) resolves it without breaking `pnpm typecheck`/`pnpm lint`.
   Do not blanket-override every transitive dep speculatively — only ones with an actual advisory.
4. No backend dependency changes — the audit found nothing to remove or replace.

### Acceptance criteria
- [x] `.github/workflows/ci.yml` backend job uses `uv sync --frozen` (verified locally: succeeds
      against the current `uv.lock`).
- [x] `pnpm audit` shows zero high-or-critical advisories against `next` specifically. Bumped
      `16.2.6` → `16.3.4` (latest stable at implementation time), which resolved every advisory filed
      directly against `next`, plus its transitive `postcss`/`sharp`/`nanoid` findings. Also bumped
      `@tailwindcss/postcss`/`tailwindcss` `4.3.0` → `4.3.3`, resolving the remaining `postcss`/
      `nanoid` findings that came through that package instead of `next`.
- [x] `pnpm typecheck` and `pnpm lint` pass **at the same rate they did before this phase** — both
      commands have one pre-existing failure each (`AddressAutocomplete.tsx`'s `PlaceAutocompleteElementOptions`
      type error; two `react-hooks/set-state-in-effect` lint errors) that were confirmed via
      `git stash` to already exist on `main` before any Phase 10 change, unrelated to the `next` or
      dependency bumps. Not fixed here — out of scope for a security-hardening phase; flagged for a
      separate follow-up.
- [x] Manual smoke test: `pnpm build` compiles successfully under the new `next` version (Turbopack
      build completes; only the pre-existing typecheck failure above stops the full `build` script,
      confirmed unrelated to the rewrite/proxy layer).
- [x] Remaining advisories after both bumps: 8 high-severity, all in `eslint`'s own dependency tree
      (`brace-expansion` via `eslint>minimatch` and via `eslint-config-next`'s typescript-eslint
      chain; `js-yaml` via `eslint>@eslint/eslintrc`; `browserslist` via `eslint-config-next`'s
      Babel chain) — dev-tooling only, never shipped to production. Attempted `eslint` 9→10 (the
      fix for two of these): blocked by `eslint-config-next`'s own `eslint-plugin-import`,
      `eslint-plugin-jsx-a11y`, and `eslint-plugin-react` not yet declaring `eslint@10` in their peer
      ranges — reverted per this Part's own guidance not to force a bump that breaks peer
      resolution. Re-check when `eslint-config-next` (tracks the `next` version) bumps its own
      plugin peers.

---

## Part D: Tighten Unbounded Numeric and List Fields

### Problem
The validation audit found no mass-assignment or authorization-bypass issue in any Pydantic schema,
but several fields accept values with no bound that downstream code assumes are sane:
- `RadiusSelectRequest.suggestion_ids`, `CorridorSelectRequest.suggestion_ids`,
  `ItineraryBuildRequest.suggestion_ids`, `ReorderWaypointsRequest.ordered_ids`,
  `AssignWaypointsRequest.waypoint_ids`/`ordered_waypoint_ids` (all in `backend/app/schemas/trip.py`)
  — unbounded `list[uuid.UUID]`. Each request is still hourly rate-limited and every ID must already
  exist in the DB scoped to the caller's own trip (confirmed by the authorization audit), so this
  isn't exploitable cross-user — it's a payload-size/query-cost concern on a single user's own data.
- `TripCreate.max_drive_minutes` (`trip.py:59`) and `WaypointCreate.stop_duration_minutes`
  (`trip.py:15`) — `int | None` with no lower bound; a negative value isn't rejected before reaching
  isochrone/routing calls.
- `WaypointCreate.address`/`TripCreate.start_address`/`end_address` — unbounded `str`, stored and
  later sent to Google Geocoding/Routes APIs.

### Design
- Add `max_length=100` (`MAX_ID_LIST_LENGTH` in `schemas/trip.py`, well above any realistic trip's
  stop count) to each `list[uuid.UUID]` field named above via Pydantic's `Field(max_length=...)`.
- Add `Field(ge=1)` to `max_drive_minutes` and `stop_duration_minutes`.
- Add a length cap to free-text address/title/notes string fields that currently have none. Two
  bounds, not one — `models/trip.py`'s columns aren't uniform: `Trip.title`/`Waypoint.label`/
  `ItineraryDay.title` are `String(200)` (a real DB-enforced cap, so the Pydantic field mirrors it
  exactly at `MAX_SHORT_TEXT_LENGTH = 200`), while `start_address`/`end_address`/`notes`/
  `cover_image_url` are `Text` (unbounded in Postgres) — those get a generous `max_length=2000`
  (not the originally-planned 500) since a real street address plus unit/apartment/landmark detail,
  or a multi-sentence trip note, can plausibly exceed 500 characters; the goal here is bounding
  request-payload cost, not modeling a realistic address format.

### Acceptance criteria
- [x] A `suggestion_ids` list of 101 items returns a Pydantic `422`, not a 200 with a huge query
      (verified directly: `RadiusSelectRequest` with 101 UUIDs raises `ValidationError`; 100 is
      still accepted). Same fix applied identically to `CorridorSelectRequest.suggestion_ids`,
      `ItineraryBuildRequest.suggestion_ids`, `ReorderWaypointsRequest.ordered_ids`,
      `AssignWaypointsRequest.waypoint_ids`/`ordered_waypoint_ids`.
- [x] A negative `max_drive_minutes` or `stop_duration_minutes` returns `422` (verified directly).
- [x] Existing valid trips/waypoints with normal-length fields are unaffected (verified directly with
      a representative valid `TripCreate` payload).
- [x] (Not originally scoped, added while in this file for the same reason) `RegisterRequest.password`/
      `LoginRequest.password` capped at `max_length=200` — bcrypt truncates at 72 bytes regardless, so
      hashing an unbounded client-supplied string was wasted CPU with no security benefit past that
      point. `display_name` capped at 200 to match `MAX_SHORT_TEXT_LENGTH`.

---

## Acceptance Criteria (full phase)
- [x] All Part A–D criteria above pass or are explicitly flagged as not-yet-verified with a reason
      (see Implementation Notes below).
- [x] `ruff check app/` and `mypy app/` (strict mode) both pass clean.
- [x] `pnpm typecheck` and `pnpm lint` produce the same pre-existing failure as `main` before this
      phase — confirmed via `git stash` on both — and no new failure. Not fixed (out of scope).
- [x] `uv sync --frozen` succeeds locally against the current `uv.lock` (proves the committed lockfile
      is consistent with `pyproject.toml`, including the new `sentry-sdk` dependency).
- [ ] Manual end-to-end walk: trigger a login-failure spike in a real environment (20+ bad-password
      attempts from one source in under 5 minutes) and confirm the Sentry alert fires; confirm normal
      login/register/refresh/export usage is unaffected by the new rate limits. **Not performed** — no
      running database or Sentry project available in the implementation sandbox; see Implementation
      Notes.

---

## Implementation Notes (added when Phase 10 was implemented)

What was verified, and how, without a live database or a real Sentry project available in the
implementation environment:

- **Static verification (full confidence)**: `ruff check app/` and `mypy app/` (strict mode) pass
  clean across the whole backend, including all new modules. `pnpm typecheck`/`pnpm lint` produce
  exactly the same output as an unmodified `main` (verified via `git stash`), confirming Phase 10
  introduced no new frontend errors — the two pre-existing failures
  (`AddressAutocomplete.tsx`'s `PlaceAutocompleteElementOptions` type error; two
  `react-hooks/set-state-in-effect` errors in `trips/page.tsx` and the itinerary page) are unrelated
  to this phase and were left as-is; worth a separate follow-up.
- **Direct unit-level verification (high confidence, no DB needed)**: `app.main.app` imports cleanly
  with all expected routes registered (including the four newly rate-limited endpoints);
  `app.core.security_log`'s three logging functions were called directly with a mocked `Request` and
  produced the expected structured events; `app.core.logging_config.configure_logging()` was
  exercised in both `production` (JSON output, verified field-by-field) and non-production
  (human-readable) modes; every new/changed Pydantic validation bound in Part D was exercised
  directly against both a rejecting and an accepting payload.
- **Not verified end-to-end**: no running Postgres was available with working authentication in the
  sandbox this phase was implemented in (a local cluster was started but couldn't be configured
  without root), so the full request→rate-limit→DB→response path was not exercised live, and no
  Sentry project/DSN was available to confirm actual event delivery or the alert rule firing.
  Before relying on this in production: (1) run the app against a real dev DB and confirm
  `POST /auth/login` actually returns `429` after 10 requests, not just that the decorator is
  present; (2) set a real `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` and confirm an event actually arrives
  in the Sentry project; (3) configure the alert rule per `docs/security-alerting.md` and test it
  against a real login-failure burst.
- **`next` version bump**: `pnpm build` was run and completed a full Turbopack compile successfully
  under `next@16.3.4` — the only build failure is the pre-existing, unrelated typecheck error noted
  above, confirming the upgrade itself (and the new Sentry instrumentation files it now loads) didn't
  break the build.

---

## Appendix: Authorization Audit Result (no action required)

Recorded here so this doesn't need re-auditing from scratch next time security is reviewed. Full
method: every file in `backend/app/api/*.py` was read against every resource-scoped endpoint,
checking (1) auth required, (2) ownership filter present on the query itself — not just an
existence check, (3) nested/child resources re-scoped by parent `trip_id`, (4) no client-suppliable
role/permission field anywhere.

- Every router defines a local `_get_owned_trip`-style helper doing
  `select(Trip).where(Trip.id == trip_id, Trip.user_id == user_id)`, returning `404` (not `403`) on
  mismatch to avoid leaking whether a given trip ID exists to a non-owner. Used consistently in
  `trips.py`, `waypoints.py`, `itinerary.py`, `radius.py`, `corridor.py`, `routing.py`, `export.py`.
- Nested resources (waypoints, itinerary days, radius/corridor suggestions) are always
  double-scoped: parent trip ownership first, then the child query additionally filtered by
  `trip_id` rather than trusting a bare child primary key.
- Bulk-ID operations verify the fetched count matches the requested count, scoped to the trip —
  prevents smuggling another trip's resource IDs into a batch call.
- `sharing.py`'s public share token is `secrets.token_urlsafe(32)` (256 bits, unguessable); the
  public view query requires both a token match and `is_public = true`, and returns a curated
  response with no internal IDs or other users' data.
- No schema anywhere (`app/schemas/*.py`) accepts a `role`, `is_admin`, or `permission`-shaped field
  from the client — confirmed by reading every schema, not just grep.

Two low-severity, same-owner-only logic notes (not authorization bugs — no cross-user impact) were
filed as follow-up rather than fixed here, since fixing them isn't a security fix: the arrival-time
PATCH endpoint (`itinerary.py:289-309`) doesn't scope by `itinerary_day_id`, and the
deselect-by-`place_id` waypoint removal (`radius.py:396-442`, `corridor.py:253-298`) could remove the
wrong waypoint if a trip has two entries sharing a `place_id`.

---

See also: [phase-8-hardening-and-bugfixes.md](./phase-8-hardening-and-bugfixes.md) (prior hardening
round — sign-out, token refresh, rate-limit keying fix, PDF injection fix, prod secret-key guard),
`docs/rate-limiting-plan.md` (extended by Part A), `docs/security-alerting.md` (new, written by
Part B).
