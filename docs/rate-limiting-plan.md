# API Rate Limiting Plan

## Goals

1. Prevent a single user from exhausting Google API quotas
2. Protect expensive endpoints (radius discovery, route calculation) from accidental or abusive hammering
3. Keep implementation simple — no Redis or external infrastructure required at this stage

---

## Two-Layer Strategy

Rate limiting is applied at two layers:

- **Per-user limits** — enforced in FastAPI middleware using an in-process token bucket stored in memory. Protects against a single authenticated user making too many requests.
- **Google Cloud quotas** — enforced at the API key level in Google Cloud Console. Acts as the hard ceiling regardless of what reaches the backend. See `docs/maps-provider-decision.md` for recommended quota values.

In-process limiting is sufficient for a single-server deployment. If the app scales to multiple backend instances, the in-memory store must be replaced with Redis (noted in the trade-offs section).

---

## Endpoint Classification

### Expensive — hits external paid APIs

| Endpoint | External calls per request | Limit |
|---|---|---|
| `POST /trips/{id}/radius/discover` | ORS isochrone + up to 5 Nearby Search + up to 4 Distance Matrix batches | 3 / user / hour |
| `POST /trips/{id}/calculate-route` | 1 Directions API call | 10 / user / hour |
| `GET /geocode` | 1 Geocoding API call | 30 / user / hour |

### Cheap — database only

| Endpoint | Limit |
|---|---|---|
| `POST /trips/{id}/radius/select` | 20 / user / hour |
| All other trip/waypoint CRUD | 60 / user / hour |

---

## Implementation

### Library

Use **`slowapi`** — a FastAPI/Starlette wrapper around the `limits` library. No infrastructure changes required; limits are stored in memory by default.

```
# Add to backend/pyproject.toml dependencies
slowapi>=0.1.9
```

### Setup in `backend/app/main.py`

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Key on authenticated user ID when available, fall back to IP
def get_user_or_ip(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if user and hasattr(user, "id"):
        return str(user.id)
    return get_remote_address(request)

limiter = Limiter(key_func=get_user_or_ip)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

### Applying limits to routes

Decorate each endpoint with `@limiter.limit(...)`:

```python
# backend/app/api/radius.py
from slowapi import Limiter
from slowapi.util import get_remote_address

@router.post("/trips/{trip_id}/radius/discover")
@limiter.limit("3/hour")
async def discover(request: Request, trip_id: uuid.UUID, ...):
    ...

# backend/app/api/routing.py
@router.post("/trips/{trip_id}/calculate-route")
@limiter.limit("10/hour")
async def calculate_route(request: Request, trip_id: uuid.UUID, ...):
    ...

@router.get("/geocode")
@limiter.limit("30/hour")
async def geocode(request: Request, ...):
    ...
```

The `request: Request` parameter must be added to each decorated endpoint signature — `slowapi` requires it even if the handler doesn't otherwise use it.

### Error response

When a limit is exceeded, `slowapi` returns:

```
HTTP 429 Too Many Requests
Retry-After: <seconds until window resets>
```

The frontend should handle 429s gracefully — show a message like "Too many requests, please wait a minute" rather than a generic error.

---

## Rate Limit Values Rationale

| Endpoint | Limit | Reasoning |
|---|---|---|
| `/radius/discover` | 3/hour | Each call makes ~10 external API calls. 3/hour = ~30 external calls max per user per hour, well within daily quota headroom. |
| `/calculate-route` | 10/hour | One Directions call per request. Users rarely recalculate more than a few times per session. |
| `/geocode` | 30/hour | Used as a fallback; autocomplete handles most lookups client-side. |
| `/radius/select` | 20/hour | DB only, but triggers a route calculation internally — limit conservatively. |
| Other CRUD | 60/hour | Standard REST protection; 1/min sustained is generous for normal use. |

---

## Trade-offs and Future Considerations

### In-memory storage limitation
`slowapi` defaults to an in-memory store. This means:
- Limits reset on server restart
- Limits are **not shared across multiple backend instances** — if you run 2 uvicorn workers or deploy to multiple containers, each instance tracks limits independently

**When to switch:** if you deploy more than one backend instance, replace the default store with a Redis backend:
```python
from limits.storage import RedisStorage
limiter = Limiter(key_func=get_user_or_ip, storage_uri="redis://localhost:6379")
```

### Authenticated vs unauthenticated requests
The `get_user_or_ip` key function above keys on user ID when the request is authenticated, and falls back to IP address for unauthenticated endpoints (e.g. `/geocode`, which currently has no auth guard). This means:
- Authenticated users get per-account limits — fair across shared IPs (office, home)
- Unauthenticated endpoints are limited per IP — adds basic protection before auth is checked

### Burst vs sustained limits
`slowapi` supports sliding window limits out of the box (`3/hour` means 3 in any rolling 60-minute window, not 3 per clock hour). This is the correct behavior for protecting against bursts.

### Frontend feedback
Add a check for `response.status === 429` in `frontend/src/lib/api.ts` and surface a user-friendly message. The `Retry-After` header can be read to show a countdown if desired.

---

## Implementation Order

1. Add `slowapi` to `backend/pyproject.toml`
2. Wire up `Limiter` and exception handler in `backend/app/main.py`
3. Apply `@limiter.limit` to the three expensive endpoints first (`/discover`, `/calculate-route`, `/geocode`)
4. Apply broader CRUD limits as a second pass
5. Add 429 handling in `frontend/src/lib/api.ts`
