# PRD — Phase 8: Hardening & Bug Fixes

## Overview
Phases 0–5 and 7 are shipped and working, but a codebase audit surfaced a handful of confirmed
defects that undercut them: authentication that doesn't fully work (sign-out is a no-op, access
tokens expire with no recovery path), a rate limiter that silently doesn't limit anything, an
unescaped HTML-injection path in PDF export, and a JWT signing key that defaults to a public,
guessable string in production. None of these require new product surface — they're corrections to
already-built features. This phase fixes them before any further feature work lands on top.

## Prerequisites
Phases 1–5 and 7 complete (current `main`). No dependency on Phase 6.

## Goals
- Sign-out actually ends the session, server-side and client-side.
- A session survives longer than 15 minutes of active use without erroring.
- Rate limits apply per-user as documented, not per-IP-per-router-instance.
- User-supplied text can never inject markup or trigger outbound fetches from PDF export.
- The app refuses to boot in production with a default/placeholder signing key.
- Upstream API errors don't leak raw exception text to clients.

## Out of Scope
- New features of any kind (see Phase 9 for the highest-value net-new work).
- Moving the rate limiter's storage backend to Redis — flagged in
  `docs/rate-limiting-plan.md:127-135` as necessary for multi-instance deploys, but this phase only
  fixes the current single-instance implementation being wrong, not scaling it out.
- Global navigation / sign-out UI (Phase 9, Part B) — this phase delivers the working endpoint and
  client-side call; making sign-out reachable from every page is bundled with the nav work since
  they touch the same layout files.
- Full test suite — Phase 10 (not yet written).

---

## Part A: Sign-Out

### Problem
`AuthContext.logout()` (`frontend/src/context/AuthContext.tsx:143-148`) clears in-memory auth state
but never clears the httpOnly `refresh_token` cookie. There is no backend logout endpoint —
`backend/app/api/auth.py` has only `register`/`login`/`refresh`/`me`. After "signing out",
`frontend/src/proxy.ts:21-25` still sees a valid cookie and redirects `/login` → `/trips`, where the
mount effect calls `/auth/refresh` and silently re-authenticates. The 30-day refresh cookie
outlives the user's intent to end the session.

### API Endpoint
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/logout` | No body. Calls `response.delete_cookie(REFRESH_COOKIE, path="/")` using the same `samesite`/`secure` attributes as `_set_refresh_cookie` (`auth.py:28-38`) — a `delete_cookie` with mismatched attributes silently fails to clear the cookie in the browser. Always returns 204, whether or not a cookie was present. Does not require auth (a stale/expired access token shouldn't block clearing the refresh cookie). |

### Frontend
- New route handler `frontend/src/app/api/auth/logout/route.ts`, mirroring the existing
  login/register/refresh handlers under `frontend/src/app/api/auth/`, so the backend's
  `Set-Cookie: refresh_token=; Max-Age=0` reaches the browser on the Next.js app's own origin.
- `AuthContext.logout()` becomes `async`, `await`s the `/api/auth/logout` call before clearing
  `tokenRef`, `loggedInRef`, and `state` — clear client state regardless of whether the network call
  succeeds (a failed logout call shouldn't trap the user in a logged-in-looking UI).

---

## Part B: Token Refresh on Expiry

### Problem
Access tokens expire after 15 minutes (`backend/app/config.py:10`,
`access_token_expire_minutes`). `frontend/src/lib/api.ts`'s `request<T>` (`:18-54`) throws on any
non-OK response and never retries. `AuthContext` exports `setToken` but nothing calls it outside the
initial login/register/mount-refresh paths — there is no proactive or reactive refresh. A tab left
open past 15 minutes turns every subsequent action into a raw `API 401: {"detail":"Not
authenticated"}` error banner, with no recovery short of a manual page reload.

### Design
Reactive refresh-on-401 in the shared request function, not a proactive timer (avoids refreshing
sessions that are sitting idle in a background tab):

1. In `request<T>` (`frontend/src/lib/api.ts`), when a response is `401`, attempt exactly one
   `POST /api/auth/refresh` before failing.
2. Concurrent requests that 401 around the same time must not each trigger their own refresh call.
   Use a module-level in-flight promise (`let _refreshPromise: Promise<string | null> | null`) that
   all concurrent 401s await instead of independently calling refresh.
3. On successful refresh: update the token via the existing `setApiToken`, and replay the original
   request once with the new token.
4. On failed refresh (401/network error): clear the token (`setApiToken(null)`), and surface a
   distinct error/redirect path so the caller can route to `/login` — reuse `AuthContext`'s existing
   `logout()`-adjacent state-clearing rather than duplicating it in `api.ts`.
5. Requests to `/auth/*` paths never trigger this path (avoids infinite recursion on a failing
   refresh call itself).
6. Only retry once per original request — a second 401 after a successful-looking refresh means the
   session is truly invalid, not a transient race.

### Acceptance criteria specific to this part
- With `access_token_expire_minutes` temporarily set to `1` for testing, a user idle for 90 seconds
  who then performs an action sees it succeed with no visible error, and the network log shows one
  `/auth/refresh` call before the retried request.
- Five API calls fired concurrently right after expiry produce exactly one `/auth/refresh` call, not
  five.
- A session with an expired/invalid refresh cookie (e.g. after Part A's logout) gets a clean redirect
  to `/login`, not a silent failure or infinite retry loop.

---

## Part C: Rate Limiting Fix

### Problem
Two independent defects make the documented per-user rate limiting
(`docs/rate-limiting-plan.md`) not actually apply per-user:

1. `_get_user_or_ip` (`backend/app/main.py:20-24`) reads `request.state.user` to key limits by
   authenticated user ID, falling back to IP. **Nothing in the codebase ever sets
   `request.state.user`** — `get_current_user` (`backend/app/core/deps.py:17-37`) returns the `User`
   object to the caller via dependency injection but never writes it onto `request.state`. Every
   request keys by IP regardless of auth status.
2. Even if (1) were fixed, it wouldn't matter for the three limited routers: `routing.py:18`,
   `radius.py:31`, and `corridor.py:28` each construct their **own** `Limiter(key_func=get_remote_address)`
   instead of importing the app-level `limiter` registered in `main.py:27`. The
   `@limiter.limit(...)` decorators on individual endpoints reference these shadow instances, so the
   app-level limiter governs nothing at all.

Net effect: limits are IP-based, per-process, and in-memory — shared-NAT users (offices, campus wifi)
collide with each other's budgets, and every documented "N/user/hour" limit is actually "N/IP/hour"
against a fraction of what the code implies.

### Design
1. In `get_current_user` (`backend/app/core/deps.py`), add the `Request` object as a dependency and
   set `request.state.user = user` before returning, so `_get_user_or_ip` in `main.py` has something
   to read.
2. Move the single `Limiter` instance out of `main.py` into a new `backend/app/core/limiter.py`
   (avoids the circular import that likely caused the per-router duplication in the first place —
   routers importing `main.limiter` would import the whole app). `main.py` imports it from there for
   `app.state.limiter` registration.
3. Delete the three shadow `Limiter(key_func=get_remote_address)` instances in `routing.py`,
   `radius.py`, and `corridor.py`; import the shared instance from `app.core.limiter` instead. No
   change to the `@limiter.limit("N/hour")` decorator call sites or their documented values — only
   the limiter instance they reference changes.
4. Unauthenticated endpoints (`/geocode`) keep falling back to IP-based limiting via the same
   `_get_user_or_ip`, unchanged.

### Acceptance criteria specific to this part
- Two different authenticated users behind the same IP (e.g. same office network) each get their own
  independent rate-limit budget on `/trips/{id}/radius/discover`.
- A single authenticated user making requests from two different IPs (e.g. wifi + cellular) shares
  one budget, not two.
- Exceeding a limit still returns `429` with `Retry-After`, matching current behavior and the
  frontend's existing handling in `lib/api.ts:36-43`.
- `docs/rate-limiting-plan.md` is updated to note the fix (the doc's described design was already
  correct; the code didn't match it).

---

## Part D: PDF Export HTML Injection

### Problem
`_build_html` (`backend/app/api/export.py:36-154`) constructs the exported PDF's HTML via f-strings
with no escaping anywhere. Confirmed unescaped user-controlled interpolations: waypoint
`label`/`address` (`:59`, `:87`), day `title` (`:71`), day `notes` (`:74`), trip `title` (`:126`),
`start_address`/`end_address` (`:129-130`). WeasyPrint renders this HTML and, by default, **fetches
external resources** (images, stylesheets) referenced within it. Because trips are shareable, this
is exploitable via another user's content, not just self-inflicted: a payload stored in any of these
fields turns every future PDF render of that trip into a server-side outbound request — a stored
SSRF vector, not just cosmetic markup breakage.

### Design
1. Add a local escaping helper in `export.py`: `_e(value: object) -> str` wrapping
   `html.escape(str(value or ""))`. Apply it to every user-controlled interpolation in
   `_build_html` — the seven sites listed above, plus any others introduced by future edits to this
   function (the fix should make raw interpolation of a model field the exception, not fixing only
   today's list).
2. Defense in depth: pass a `url_fetcher` to `weasyprint.HTML(string=html, url_fetcher=...)` at
   `export.py:184` that rejects any scheme other than `data:` (no network fetches at all). This means
   escaping bugs in the future degrade to broken-looking text, not an SSRF request.
3. `safe_title` (`export.py:186`) already sanitizes the *filename* correctly — no change needed
   there; this fix is scoped to the HTML *body*.

### Acceptance criteria specific to this part
- A trip titled `<img src=x onerror=alert(1)>` with a waypoint labeled `<script>` renders those as
  literal visible text in the exported PDF, not as markup.
- A trip field containing `<img src="http://169.254.169.254/...">` (or any non-`data:` URL) produces
  no outbound request when exported — verified via the `url_fetcher` rejecting it, not just via
  escaping.
- Existing valid trips with normal titles/notes export unchanged.

---

## Part E: Production Secret-Key Guard

### Problem
`secret_key: str = "changeme"` (`backend/app/config.py:6`) has no runtime check. If
`SECRET_KEY` is unset in a production environment, the app boots normally and signs real,
trusted JWTs with a value visible in this repo's source.

### Design
Add a `model_validator` (or equivalent) to `Settings` in `config.py` that raises at startup if
`environment == "production"` and `secret_key == "changeme"`. Fail loudly and immediately — do not
log-and-continue. No change to default behavior in development/test environments, where the
placeholder remains convenient.

### Acceptance criteria specific to this part
- Starting the app with `ENVIRONMENT=production` and no `SECRET_KEY` set fails at startup with a
  clear error, before accepting any requests.
- Starting the app with `ENVIRONMENT=production` and a real `SECRET_KEY` set boots normally.
- Development/default startup (`ENVIRONMENT` unset or `development`) is unaffected.

---

## Part F: Stop Leaking Upstream Errors to Clients

### Problem
`radius.py:88` and `corridor.py:89` build the client-facing `HTTPException` detail as
`f"Discovery failed: {exc}"`, interpolating the raw caught exception. Google/ORS client errors can
include request URLs or other upstream-internal detail that shouldn't reach the browser.

### Design
Log the full exception server-side (`logger.exception(...)`, already imported in both files) and
return a fixed, generic `detail` string to the client (e.g. `"Discovery failed. Please try again."`).
No behavior change to the HTTP status code used (502/503, unchanged).

### Acceptance criteria specific to this part
- A simulated upstream failure (e.g. ORS timeout) results in a client response with a generic
  message and a server log line containing the actual exception.

---

## Acceptance Criteria (full phase)
- [ ] Signing out clears the `refresh_token` cookie in the browser; a hard reload after sign-out
      redirects to `/login` and does not silently re-authenticate.
- [ ] A session idle for longer than `access_token_expire_minutes` recovers transparently on the
      next action (one refresh call, request replayed, no visible error).
- [ ] Concurrent requests after token expiry trigger exactly one refresh call.
- [ ] Two authenticated users sharing an IP have independent rate-limit budgets; `request.state.user`
      is set by `get_current_user` and read by the single shared `Limiter` used across all routers.
- [ ] No per-router shadow `Limiter` instances remain in `routing.py`, `radius.py`, or `corridor.py`.
- [ ] PDF export escapes all user-controlled fields and rejects non-`data:` URL fetches during
      rendering.
- [ ] The app refuses to start in production with the default `secret_key`.
- [ ] `radius/corridor` discovery failures return a generic client message while logging the real
      exception server-side.
- [ ] Full regression pass: `ruff check app/`, `mypy app/`, `pnpm typecheck`, `pnpm lint` all pass;
      manual end-to-end walk of one point-to-point trip and one radius trip (create → route/discover
      → select → build/share → export) with no new errors.

---

See also: [phase-2-auth-and-data-model.md](./phase-2-auth-and-data-model.md) (original auth design),
[phase-5-trip-management.md](./phase-5-trip-management.md) (PDF export origin),
`docs/rate-limiting-plan.md` (rate limiter design this phase brings the code in line with).
