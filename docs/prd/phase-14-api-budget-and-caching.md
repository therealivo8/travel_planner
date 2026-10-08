# PRD — Phase 14: API Budget, Caching & Cost Guardrails

## Overview
The app has no limit on total spend across all users. The current controls are:
- `slowapi` limits per user, per hour, stored in memory (`backend/app/core/limiter.py`). They
  reset on every Railway deploy and don't limit total spend across users.
- Optional daily quotas in the Google Cloud Console, described in
  `docs/maps-provider-decision.md`. These are a blunt backstop: when one trips, the app fails
  with an opaque upstream error, not a friendly "try tomorrow".
- Detection of ORS quota exhaustion (`backend/app/core/upstream_log.py`). This only reports the
  problem after it has happened; it doesn't prevent it.

Measured from the code (see [`../cost-model.md`](../cost-model.md)), a single **corridor discover**
makes up to **40 Nearby Search calls**, a Pro SKU with only 5,000 free calls a month, plus several
hundred Distance Matrix elements. Each radius discover makes a fresh ORS isochrone call even when
the same origin and drive time were requested before. One user testing corridor mode can use up the
month's free allowance in an afternoon.

This phase comes before every other new-feature phase (15–19). Those phases add users and calls,
and the budget needs to be enforced before that happens.

## Prerequisites
- Phase 11 deployed (Railway Postgres available).
- No dependency on Phases 12–13.

## Goals
1. **Hard daily and monthly budgets per upstream SKU, stored in Postgres**, checked *before* each
   paid call. When a budget is exhausted the app degrades gracefully ("Discovery is paused until
   tomorrow — your saved suggestions are still available") instead of producing a bill.
2. **Per-user daily quotas stored in Postgres** for expensive actions, so they survive deploys.
3. **Shared caches** for isochrones and discovery results, so a repeated request costs nothing.
4. **Cut the cost of corridor discovery by 3–5×** without a noticeable drop in suggestion quality.
5. **A private usage page** that shows calls used against the free allowance for the current month.

## Out of Scope
- Redis. Postgres handles these counter writes easily at this traffic level; Redis would add a
  billable service for no benefit.
- Billing users or adding paid tiers.
- Migrating off the legacy Places, Directions, and Distance Matrix APIs. That should be a separate
  decision, but note the risk: Google stopped offering legacy APIs to *new* projects in 2025. If this
  Cloud project is ever recreated, those calls will fail. Add the risk to the runbook.

---

## Part A: Upstream budget ledger

### Data model
New table `api_usage_daily`:

| column | type | notes |
|---|---|---|
| `day` | `date` | UTC day. Part of the primary key. |
| `sku` | `varchar(50)` | e.g. `google.nearby_search`, `google.distance_matrix_element`, `google.directions`, `google.geocode`, `ors.isochrone`, `anthropic.tokens_in`, `anthropic.tokens_out`. Part of the primary key. |
| `units` | `integer` | Incremented atomically: `INSERT ... ON CONFLICT (day, sku) DO UPDATE SET units = api_usage_daily.units + EXCLUDED.units`. |

New table `user_action_daily` (`day`, `user_id`, `action`, `count`). Same upsert pattern.

### Config (`backend/app/config.py`)
Store budgets as one env-overridable JSON setting so they can be changed in Railway without a deploy:

```python
# units per day / per month; month caps default to the Google free tier.
api_budgets: dict[str, dict[str, int]] = {
    "google.nearby_search":            {"day": 150, "month": 4500},   # Pro free = 5,000
    "google.distance_matrix_element":  {"day": 300, "month": 9000},   # Essentials free = 10,000
    "google.directions":               {"day": 300, "month": 9000},
    "google.geocode":                  {"day": 300, "month": 9000},
    "ors.isochrone":                   {"day": 400, "month": 1_000_000},  # ORS hard limit 500/day
}
```

Defaults are set at about 90% of each free allowance, so normal usage stays at **$0**.

### Service: `backend/app/core/budget.py`
- `async def reserve(db, sku: str, units: int) -> None`. Checks the day and month totals, raises
  `BudgetExceeded(sku, resets_at)` if the call would go over, and otherwise increments the counter
  **before** the upstream call is made. Reserving before the call is deliberate: counting a call
  that later fails is better than under-counting.
- Discovery estimates its units up front. For example, corridor reserves
  `samples × types` Nearby Search calls before any of them run, so it never gets halfway and then
  fails on the budget.
- Every call site in `services/places.py`, `services/routes.py`, and `services/radius.py` must
  reserve through this module. Add a test that greps for `gmaps.` and `httpx.post` outside
  `services/` and fails if any are found.
- The services run synchronously inside threadpools, so pass an async-safe callback in or reserve
  in the API layer. Recommendation: reserve in the API layer using the estimate, which keeps the
  services free of database code. Phase 7 relies on that separation.

### Error handling
- `BudgetExceeded` → HTTP **503** with body
  `{"detail": "...", "code": "budget_exhausted", "resets_at": "<iso>"}` and a `Retry-After` header.
- Frontend: show a calm banner, not a toast, explaining that discovery is paused and that saved
  suggestions and manual stops still work. Disable the Discover button until `resets_at`.
- Send a Sentry `capture_message` at **warning** level when any SKU passes 80% of its monthly budget,
  at most once per SKU per day. Reuse the existing `upstream_log` logger.

## Part B: Per-user quotas stored in Postgres

Keep `slowapi` for burst protection. Add daily quotas per user, stored in `user_action_daily`:

| action | per user per day |
|---|---|
| `radius_discover` | 8 |
| `corridor_discover` | 4 |
| `optimize_day` / `build_itinerary` | 20 |
| `calculate_route` | 40 |
| `ai_*` (Phase 18) | 15 |

Return a 429 with `code: "user_quota"` and the reset time. Show the remaining count next to the
Discover buttons ("3 discoveries left today"). This also tells users that discovery is a limited
resource.

## Part C: Caching

### C1. Isochrone cache (largest ORS saving, and cuts latency from 35s to 0s)
ORS data is derived from OpenStreetMap (ODbL), so caching it is allowed.

New table `isochrone_cache`: `origin_key varchar(32)`, `minutes smallint`, `geojson jsonb`,
`created_at`. The primary key is (`origin_key`, `minutes`).
- `origin_key` = lat/lng rounded to 3 decimals (about 110 m), e.g. `"40.713,-74.006"`.
- TTL: 90 days, because the road network changes slowly. Delete expired rows lazily on read.
- `fetch_isochrone()` checks the cache first. This also mostly removes the risk, noted in memory, of
  a 60-minute radius trip running past Vercel's 60s function timeout, since repeat requests no
  longer wait on ORS.

### C2. Discovery result cache (Google)
Google Maps Platform terms allow caching **place IDs indefinitely**, but most other Places content
(names, ratings) only temporarily. **Check the current Service Specific Terms** before choosing a
TTL. This PRD assumes ≤ 30 days.

New table `discovery_cache`: `cache_key varchar(128)` (primary key), `payload jsonb`, `created_at`.
- Radius key: `radius:{origin_key}:{minutes}:{sorted categories}`
- Corridor key: `corridor:{sha1(route_polyline)}:{max_detour}:{sorted categories}`
- TTL: **7 days** by default, configurable as `DISCOVERY_CACHE_TTL_DAYS`. Ratings change slowly,
  so 7 days is fresh enough.
- A cache hit does not count against the user's daily quota (Part B). Mark the response with
  `"cached": true` so the UI can show "Updated 2 days ago · Refresh". **Refresh** bypasses the
  cache and *does* count against the quota.

### C3. Clean up stored suggestions to stay within the terms
`radius_suggestions` and `corridor_suggestions` currently keep Google names and ratings forever.
Add a daily cleanup (FastAPI lifespan task or a Railway cron) that deletes **unselected**
suggestions older than 30 days. Selected suggestions have already become `waypoints` (user data
plus `place_id`) and are kept.

## Part D: Cut the cost of corridor discovery

Corridor discovery is the most expensive operation in the app. The changes below, in
`services/corridor.py` and `services/places.py`:

1. **Scale the number of samples with route length**:
   `sample_count = clamp(round(route_km / 60), 3, 8)`. A 120 km trip uses 3 samples, not 8.
2. **Use fewer place types per sample.** If the user selected categories, query only those. If not,
   query a curated set of 3 types for corridor mode (`tourist_attraction`, `park`, `restaurant`)
   instead of 5.
3. **Filter by straight-line distance before using Distance Matrix.** Drop candidates more than
   `(max_detour_minutes / 2) × 1.5 km` from the route polyline (point-to-segment distance). A
   detour goes out and back, so a stop can be at most half the detour time off-route, and 1.5 km
   per minute (90 km/h) is a generous straight-line upper bound. This is computed locally and
   costs nothing.
4. **Keep only the top 40 candidates by `quality_score`** before computing detours. Detours cost
   two elements per candidate, so this caps Distance Matrix at 80 elements per run.

Result: **≤ 24 Nearby Search calls and ≤ 80 elements** per run, down from ≤ 40 calls and ~500
elements. Free-tier capacity rises from about 20 runs/month to about 125 or more.

Apply the same pre-filter idea to `distance_matrix_pairwise`: cap optimization at 15 stops
(225 elements) and return a 400 above that, explaining why.

## Part E: Usage page

- `GET /admin/usage` checks `user.email in settings.admin_emails` (a comma-separated env var).
  There's no role system yet, and a full one isn't needed.
- It returns the month-to-date and today totals per SKU, the budget, the free allowance, and an
  estimated cost in dollars (`max(0, units - free) × unit_price`, with prices from config).
- Frontend `/admin/usage`: a simple table with a progress bar per SKU. No charting library.

---

## Acceptance Criteria
- [ ] Setting `google.nearby_search.day` to 1 makes the second corridor discover of the day return
      503 `budget_exhausted` with `resets_at`, and the UI shows the paused-discovery banner.
- [ ] Budget counters survive a Railway redeploy.
- [ ] A second radius discover from the same origin and drive time does **not** call ORS (verify
      by log or a mocked test) and returns in under 1s.
- [ ] A second corridor discover on an unchanged route within 7 days makes zero Google calls and
      shows "Updated N days ago".
- [ ] Corridor discover on a 150 km route makes ≤ 9 Nearby Search calls (3 samples × 3 types).
- [ ] Unselected suggestions older than 30 days are deleted by the cleanup job.
- [ ] `/admin/usage` is visible only to emails listed in `ADMIN_EMAILS`.
- [ ] A Sentry warning fires once when a SKU passes 80% of its monthly budget.
- [ ] `docs/maps-provider-decision.md` is corrected: the $200 credit is gone and ORS isochrones are
      500/day.

## Notes for the Implementing Agent
- Use `INSERT ... ON CONFLICT DO UPDATE ... RETURNING units`, so reserve-and-check is a single
  database round trip and is safe under concurrent requests.
- Keep the services free of database code (see the Phase 7 design note). Estimate and reserve in
  the API layer, then call the service.
- Hash the polyline for the corridor cache key. Don't use the trip ID, because two trips on the
  same route should share the cache.
- The usage page doubles as a portfolio talking point ("built a cost-governance layer for
  third-party APIs"), which fits the Phase 12 resume goals.
