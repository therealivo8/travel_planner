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

---

## Implementation

### Library

**`slowapi>=0.1.9`** — a FastAPI/Starlette wrapper around the `limits` library. Installed in `backend/pyproject.toml`. No extra infrastructure required; limits are stored in memory by default.

### `backend/app/main.py`

A `_get_user_or_ip` key function keys on authenticated user ID when available, falling back to IP address for unauthenticated requests. The `Limiter` and 429 exception handler are registered on the app:

```python
def _get_user_or_ip(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if user and hasattr(user, "id"):
        return str(user.id)
    return get_remote_address(request)

limiter = Limiter(key_func=_get_user_or_ip)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

### `backend/app/api/radius.py` and `backend/app/api/routing.py`

Each limited endpoint is decorated with `@limiter.limit(...)` and takes a `request: Request` parameter (required by `slowapi`):

```python
@router.post("/trips/{trip_id}/radius/discover")
@limiter.limit("3/hour")
async def discover(request: Request, trip_id: uuid.UUID, ...):
    ...

@router.post("/trips/{trip_id}/calculate-route")
@limiter.limit("10/hour")
async def calculate_route(request: Request, trip_id: uuid.UUID, ...):
    ...

@router.get("/geocode")
@limiter.limit("30/hour")
async def geocode(request: Request, ...):
    ...

@router.post("/trips/{trip_id}/radius/select")
@limiter.limit("20/hour")
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
