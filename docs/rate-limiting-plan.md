# API Rate Limiting

## Goals

1. Prevent a single user from exhausting Google API quotas
2. Protect expensive endpoints (radius discovery, route calculation) from accidental or abusive hammering
3. Keep implementation simple — no Redis or external infrastructure required at this stage

---

## Two-Layer Strategy

Rate limiting is applied at two layers:

- **Per-user limits** — enforced in FastAPI using `slowapi`, an in-process token bucket. Protects against a single authenticated user making too many requests.
- **Google Cloud quotas** — enforced at the API key level in Google Cloud Console. Acts as the hard ceiling regardless of what reaches the backend. See `docs/maps-provider-decision.md` for recommended quota values.

In-process limiting is sufficient for a single-server deployment. If the app scales to multiple backend instances, the in-memory store must be replaced with Redis (see trade-offs below).

---

## Endpoint Limits

### Expensive — hits external paid APIs

| Endpoint | External calls per request | Limit |
|---|---|---|
| `POST /trips/{id}/radius/discover` | ORS isochrone + up to 5 Nearby Search + up to 4 Distance Matrix batches | 3 / user / hour |
| `POST /trips/{id}/calculate-route` | 1 Directions API call | 10 / user / hour |
| `GET /geocode` | 1 Geocoding API call | 30 / user / hour |

### Cheaper — database only

| Endpoint | Limit |
|---|---|
| `POST /trips/{id}/radius/select` | 20 / user / hour |
| `GET /trips/{id}/export/pdf` | 20 / user / hour |

### Auth — unauthenticated, keyed by IP

These have no user identity to key by until *after* the credential check
succeeds (or, for register, until the account is created), so `_get_user_or_ip`
falls back to IP for all three — see "Authenticated vs unauthenticated
requests" below. Added in Phase 10 after an audit found `/auth/*` had no rate
limiting at all, making `/auth/login` in particular an open brute-force target.

| Endpoint | Limit | Reasoning |
|---|---|---|
| `POST /auth/login` | 10 / IP / hour | Generous for a real user across a few devices/retries; tight enough to blunt scripted credential stuffing. A login-failure spike (20+ in 5 min from one IP) also triggers a Sentry alert independent of this limit — see `docs/security-alerting.md` — since a distributed/IP-rotating attacker could otherwise stay under this per-IP ceiling. |
| `POST /auth/register` | 5 / IP / hour | Legitimate signups are rare per IP; this mainly blocks scripted account-creation spam. |
| `POST /auth/refresh` | 30 / IP / hour | Higher — legitimate multi-tab/multi-device usage refreshes fairly often. This is a backstop against refresh-token-guessing, not normal-usage friction. |

---

## Implementation

### Library

**`slowapi>=0.1.9`** — a FastAPI/Starlette wrapper around the `limits` library. Installed in `backend/pyproject.toml`. No extra infrastructure required; limits are stored in memory by default.

### `backend/app/core/limiter.py`

A single shared `Limiter` instance lives here, keyed by a `_get_user_or_ip` function that uses the authenticated user ID when available, falling back to IP address for unauthenticated requests:

```python
def _get_user_or_ip(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if user and hasattr(user, "id"):
        return str(user.id)
    return get_remote_address(request)

limiter = Limiter(key_func=_get_user_or_ip)
```

`request.state.user` is populated by `get_current_user` (`backend/app/core/deps.py`) on every authenticated request — this is what makes user-based keying actually work; the key function has nothing to read from otherwise.

`backend/app/main.py` imports this single instance for app-wide registration:

```python
from app.core.limiter import limiter

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

Every router that applies a rate limit (`routing.py`, `radius.py`, `corridor.py`) imports this same `limiter` from `app.core.limiter` — there must be exactly one `Limiter` instance in the app. An earlier version of this code had each router construct its own `Limiter(key_func=get_remote_address)`, which silently shadowed the app-level limiter and made every limit IP-based regardless of auth status; that has been fixed.

### `backend/app/api/radius.py` and `backend/app/api/routing.py`

Each limited endpoint is decorated with `@limiter.limit(...)` and takes a `request: Request` parameter (required by `slowapi`):

```python
@router.post("/trips/{trip_id}/radius/discover")
@limiter.limit("10/hour")
async def discover(request: Request, trip_id: uuid.UUID, ...):
    ...

@router.post("/trips/{trip_id}/calculate-route")
@limiter.limit("20/hour")
async def calculate_route(request: Request, trip_id: uuid.UUID, ...):
    ...

@router.get("/geocode")
@limiter.limit("30/hour")
async def geocode(request: Request, ...):
    ...

@router.post("/trips/{trip_id}/radius/select")
@limiter.limit("25/hour")
async def select_suggestions(request: Request, trip_id: uuid.UUID, ...):
    ...
```

### Error response

When a limit is exceeded, `slowapi` returns:

```
HTTP 429 Too Many Requests
Retry-After: <seconds until window resets>
```

### `frontend/src/lib/api.ts`

The central `request()` function checks for 429 before the generic error handler and reads the `Retry-After` header to show a specific countdown:

```typescript
if (res.status === 429) {
  const retryAfter = res.headers.get("Retry-After");
  const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
  const message = seconds
    ? `Too many requests. Please wait ${seconds} second${seconds !== 1 ? "s" : ""} before trying again.`
    : "Too many requests. Please wait a moment before trying again.";
  throw new Error(message);
}
```

---

## Rate Limit Values Rationale

| Endpoint | Limit | Reasoning |
|---|---|---|
| `/radius/discover` | 3/hour | Each call makes ~10 external API calls. 3/hour = ~30 external calls max per user per hour, well within daily quota headroom. |
| `/calculate-route` | 10/hour | One Directions call per request. Users rarely recalculate more than a few times per session. |
| `/geocode` | 30/hour | Fallback only — autocomplete handles most lookups client-side. |
| `/radius/select` | 20/hour | DB only, but triggers a route calculation internally when `generate_route=true`. |
| `/trips/{id}/export/pdf` | 20/hour | DB only, but each call runs a WeasyPrint HTML→PDF render — CPU/memory-heavy enough to be a plausible DoS vector if uncapped. |
| `/auth/login` | 10/hour/IP | Brute-force/credential-stuffing target — this is the credential check itself, so it can't be keyed by user. |
| `/auth/register` | 5/hour/IP | Signup-abuse/spam-account target. |
| `/auth/refresh` | 30/hour/IP | Backstop against refresh-token-guessing; kept generous since legitimate multi-device usage refreshes often. |

---

## Trade-offs and Future Considerations

### In-memory storage limitation
`slowapi` defaults to an in-memory store. This means:
- Limits reset on server restart
- Limits are **not shared across multiple backend instances** — if you run 2 uvicorn workers or deploy to multiple containers, each instance tracks limits independently

**When to switch:** if you deploy more than one backend instance, replace the default store with a Redis backend:
```python
limiter = Limiter(key_func=_get_user_or_ip, storage_uri="redis://localhost:6379")
```

### Authenticated vs unauthenticated requests
- Authenticated users are keyed on user ID — fair across shared IPs (office, home network)
- Unauthenticated endpoints (e.g. `/geocode`) fall back to IP limiting — adds basic protection before auth is checked

### Sliding window
`slowapi` uses a sliding window by default — `3/hour` means 3 in any rolling 60-minute window, not 3 per clock hour. This correctly prevents bursts at the boundary of a fixed window.
