# PRD — Phase 7: Corridor Stops & Itinerary Optimization

## Overview
Google Maps shows you a route. This app finds what's *worth stopping for* along that route within a detour budget you control, and builds a same-day itinerary that respects your time budget without you manually re-ordering stops. Phases 3–5 already deliver point-to-point routing and radius-mode discovery, but both stop short of real itinerary-building: point-to-point has no way to discover stops *between* the start and end, and radius mode's "select suggestions → build route" flow ignores whether the resulting round trip is actually a reasonable day. This phase closes both gaps.

## Prerequisites
- Phases 1–5 complete: auth, full CRUD, point-to-point routing, radius mode, itinerary/sharing/export.
- Runs independently of Phase 6 (LLM integration) — no Anthropic dependency — but is designed so Phase 6 can build on it (see "Phase 6 hook-in" below).

## Goals
- **Corridor stops** (point-to-point): discover POIs along the calculated route within an acceptable detour, not just near a single point.
- **Radius itinerary builder** (radius mode): order selected suggestions to minimize backtracking and validate the round trip against a time budget, dropping stops if needed rather than silently building an unreasonable day.
- **Quality-aware ranking**: within a given time/detour range, surface the most popular/highly-regarded places first, instead of ranking purely by proximity (see Part C).

## Out of Scope
- LLM-generated suggestions (Phase 6) — though this phase's discovery function is built to be reusable by Phase 6.
- Multi-day itinerary optimization (the existing day-based itinerary builder from Phase 5 still handles multi-day scheduling; this phase is single-day/single-round-trip).

---

## Part A: Corridor Stops (point-to-point)

### Data Model
New table `corridor_suggestions`, parallel to `radius_suggestions` but keyed to route position instead of origin distance:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips.id | ON DELETE CASCADE |
| `place_id` | VARCHAR(300) | Google Place ID |
| `name` / `address` | VARCHAR / TEXT | |
| `lat` / `lng` | NUMERIC(10,7) | |
| `category` | VARCHAR(100) | |
| `rating` | NUMERIC(3,1) | |
| `user_ratings_total` | INTEGER | Google review count — see Part C |
| `detour_seconds` | INTEGER | extra drive time vs. the direct route |
| `route_fraction` | NUMERIC(5,4) | 0.0–1.0 position along the route where found |
| `selected` | BOOLEAN | default false |
| `created_at` | TIMESTAMPTZ | |

### API Endpoints
| Method | Path | Notes |
|---|---|---|
| POST | `/trips/{trip_id}/corridor/discover` | `3/hour`. Query: `categories[]`, `max_detour_minutes` (default 15). 400 if not point-to-point or no route calculated yet. |
| GET | `/trips/{trip_id}/corridor/suggestions` | Cached read, no external calls. |
| POST | `/trips/{trip_id}/corridor/select` | `20/hour`. Body: `{suggestion_ids, insert_as_waypoints}`. Inserts selected stops as waypoints ordered by `route_fraction` and recalculates the route. |
| DELETE | `/trips/{trip_id}/corridor/suggestions/{id}/select` | Deselects and removes the corresponding waypoint. |

### Discovery pipeline (`app/services/corridor.py`)
1. Decode the trip's stored `route_polyline`.
2. Sample ~8 points evenly spaced by cumulative distance along the route.
3. Run Places Nearby Search around each sample (reusing `app/services/places.py`), deduplicating across samples.
4. For each candidate, compute `detour_seconds = drive(start→candidate) + drive(candidate→end) − direct_drive_seconds` via Distance Matrix.
5. Filter to candidates within `max_detour_minutes`, then rank by detour-time bucket + quality score (Part C) instead of a plain sort by detour ascending.

### Frontend
- New page `/trips/{trip_id}/corridor` — same map + sidebar + category filter + multi-select pattern as radius mode's `/discover` page, with a max-detour selector (5/10/15/30/60 min) instead of an isochrone.
- Entry point: "Find stops along the way" button on the trip detail page, enabled once a route exists.

---

## Part B: Radius Itinerary Builder

No new table — this operates on existing `Waypoint` and `RadiusSuggestion` rows.

### Budget definition
The round-trip time budget for a radius-mode itinerary is `max_drive_minutes × 2` (the existing one-way isochrone cap, doubled to approximate "there and back"). No new trip field.

### API Endpoint
`POST /trips/{trip_id}/radius/build-itinerary` (`10/hour`) — body: `{suggestion_ids, stop_duration_minutes}`.
1. Runs a nearest-neighbor + 2-opt local search (`app/services/itinerary_builder.py`) over the selected stops to minimize round-trip drive time.
2. If the optimized round trip (drive + stop time) exceeds the budget, repeatedly drops the stop with the worst marginal cost and re-optimizes until it fits or no stops remain.
3. Persists the optimized order as `Waypoint` rows and calls the existing route calculation for real (Directions API) totals.
4. Returns `{waypoints, total_drive_seconds, total_stop_minutes, budget_minutes, within_budget, over_under_minutes, dropped_suggestion_ids}`.

This is additive: the existing `POST /trips/{trip_id}/radius/select` (naive, unordered) remains available; `build-itinerary` is the new "optimize for me" action.

### Frontend
- "Build Day Itinerary" button alongside the existing "Build Route" button on the `/discover` page.
- Feedback banner: fits budget (green, shows slack), stops dropped to fit (amber, names the drops), still over budget at minimal set (red, stays on page for the user to deselect and retry).

---

## Part C: Quality-Aware Ranking

### Problem
Both discovery pipelines call Google Places **Nearby Search**, which by default ranks results by Google's own `prominence` signal (an opaque blend of review volume, search/view frequency on Maps, and place category) with proximity as a secondary factor. Neither pipeline previously used the `rating` field it already fetched and displayed — suggestions were sorted purely by drive time (radius mode) or detour time (corridor mode), so a forgettable gas station one minute closer would always outrank a beloved 4.8-star landmark two minutes farther, with rating shown only as an unused badge.

### Design
Ranking works in two stages, applied identically by both `radius.py` and `corridor.py` via a shared helper in `app/services/places.py`:

1. **Time filter (unchanged)** — candidates are still filtered to those within the user's stated time budget (`max_drive_minutes` for radius, `max_detour_minutes` for corridor). Quality never overrides this: a "better" place outside the budget is still excluded.
2. **Bucket-then-rank** — within the surviving candidates, `rank_by_time_bucket_then_quality()` groups results into 5-minute time buckets (`TIME_BUCKET_SECONDS = 300`) and sorts by `quality_score` descending *within* each bucket. Sort key: `(bucket_index ascending, quality_score descending)`.

   Sorting by raw time first (the original design) would have made `quality_score` a no-op in practice — real-world drive times are almost never exactly equal, so a "sort by time, tiebreak by quality" scheme never reaches its tiebreak. Bucketing first is what lets quality actually reorder results: a highly-rated museum can now outrank a mediocre strip mall that's a minute or two closer, while a place clearly farther away still won't outrank a nearby one just for having better reviews.

3. **`quality_score` formula** (`app/services/places.py:quality_score`):
   ```
   quality_score = rating * log10(user_ratings_total + 1)
   ```
   - Raw star rating alone is misleading at low review counts — a 5.0 average from 3 reviews is noise. Multiplying by review count fixes that but overcorrects the other way: a wildly popular landmark with 100,000 reviews would then dominate every list regardless of how it compares qualitatively to a well-regarded place with 2,000 reviews. The `log10` compresses that scale — going from 10 reviews to 100 moves the score about as much as going from 10,000 to 100,000 — so review volume acts as a *confidence multiplier* on the rating rather than a popularity contest.
   - Places with no rating/review data score `0.0` and sort last within their bucket, but are never excluded outright.

### Candidate pool depth and a quality floor
Ranking can only ever surface what's in the candidate pool — and the original pool was shallow and unfiltered:
- Nearby Search returns at most 20 results per page. The pipeline queried one page per place type (up to 5 types), so ranking only ever saw Google's top ~20-per-type "prominent" results — often a mix of genuinely excellent and merely-average places. A well-reviewed spot that didn't make that top-20 for its specific type/location was invisible to `quality_score` no matter how good it was.
- No rating/review floor was applied anywhere — a place with a 2.9 rating and 4 reviews was ranked (and shown) on equal footing with everything else, just sorted toward the bottom of its time bucket rather than excluded.

Two changes address this in `app/services/places.py`:
- **Pagination** (`nearby_search(..., paginate=True)`) — follows Google's `next_page_token` up to `MAX_PAGES_PER_TYPE` (2) pages per type, roughly doubling pool depth. Each extra page requires a ~2s Google-mandated propagation delay before the token is valid. This is opt-in per caller: **radius mode enables it**; **corridor mode leaves it off** — it searches from up to 8 points along the route per request, and paginating at every one of those points would multiply the per-page delay across all of them, risking request timeouts for no clear benefit; corridor's pool depth instead comes from sampling many locations rather than paging deeply at any single one.

  The 5 place-type searches (each optionally following its own next-page) run **concurrently** via a `ThreadPoolExecutor`, not sequentially. This matters specifically because of the mandatory per-page delay: querying 5 types one after another, each waiting out its own 2s page-2 delay, stacked up to ~9s of pure wait time in initial testing — long enough to exceed the frontend dev proxy's timeout and surface as a "socket hang up" on the client. Running the (independent) per-type searches in parallel means those delays overlap instead of stacking; the same 2-page-per-type search now completes in ~2.3s, and the full discovery pipeline (isochrone + nearby search + quality filter + Distance Matrix) in ~5.5s, both measured directly.
- **Quality floor** (`filter_by_quality()`) — drops candidates below `MIN_RATING` (4.0) or `MIN_USER_RATINGS_TOTAL` (10 reviews) *before* ranking and before spending Distance Matrix calls confirming their drive/detour time. Places with no rating data at all are kept rather than excluded (there's no confirmed signal to reject them on — some genuinely good, newly-listed places haven't accumulated reviews yet); only places with a *confirmed* thin or mediocre record are dropped.

Verified in testing: for a 20-minute radius search from downtown Houston, paginated Nearby Search returned 131 raw candidates (vs. 68 pre-pagination) in ~2.3s; the quality floor and Distance Matrix filter narrowed that to 50 confirmed suggestions; the full pipeline completed in ~5.5s end-to-end. Top-ranked results within each 5-minute bucket were consistently the higher-review/higher-rating options rather than whatever happened to be marginally closer.

### Data flow
- `nearby_search()` now explicitly requests `rank_by="prominence"` (Google's default, made explicit for clarity).
- Google's Places response includes `user_ratings_total` per place; this was previously fetched implicitly but discarded. It's now captured, persisted (`radius_suggestions.user_ratings_total` / `corridor_suggestions.user_ratings_total`, added in migration `0007`), and returned to the frontend.
- `quality_score` itself is **not** stored — it's computed on read (in `RadiusSuggestionOut`/`CorridorSuggestionOut` as a Pydantic `computed_field`, and identically in `places.quality_score()` for in-process ranking) so it always reflects the current scoring formula, including for suggestions persisted before a formula change, without needing a migration or backfill.
- The cached `GET .../suggestions` endpoints re-apply `rank_by_time_bucket_then_quality()` in Python after loading rows from the database, rather than an `ORDER BY` clause in SQL — this keeps the ranking logic in one place (`places.py`) instead of duplicating the log-scale formula as a raw SQL expression.

### Frontend
`SuggestionCard` now shows the review count next to the star rating (e.g. "4.7 ★ (1.2k)") so users can see *why* a place ranks where it does, not just that it has a high star rating. The frontend does not re-sort suggestions — the backend's ranked order is treated as authoritative and displayed as-is.

### What this does not do
- It does not change *which* places are eligible on the time/detour axis — the quality floor and ranking only affect the rating/review-count axis and ordering within a fitting time bucket.
- It is not a machine-learned or personalized ranking; it's a fixed, deterministic formula over Google's own rating data.
- Radius mode's pagination does add extra Google Places API calls (up to 2x the pre-pagination call count) and a few seconds of latency per discovery; corridor mode's call volume is unchanged.

---

## Phase 6 hook-in
`corridor.discover_corridor_suggestions()` takes plain geometry/numeric inputs and returns plain candidate dicts — no FastAPI or DB coupling. A future `POST /trips/{trip_id}/ai/suggest-stops` (Phase 6) is expected to call this function directly to get a geometrically-valid candidate pool along the route, then have Claude re-rank or filter it by natural-language preference, rather than reimplementing corridor search.

## Acceptance Criteria
- [ ] `POST /trips/{trip_id}/corridor/discover` returns candidates within the specified detour for a point-to-point trip with a calculated route.
- [ ] Corridor endpoints 400 on radius-mode trips, and 400 on point-to-point trips with no route yet.
- [ ] Selecting corridor stops and inserting as waypoints produces a route that still passes through start and end.
- [ ] `POST /trips/{trip_id}/radius/build-itinerary` returns an ordered itinerary whose total (drive + stop time) is within `max_drive_minutes * 2`, dropping stops if the initial selection doesn't fit.
- [ ] Radius itinerary ordering measurably reduces total drive time versus the naive distance-from-start ordering for a spread-out selection of stops.
- [ ] Both flows work end-to-end from the UI: discover → select → build → land on the trip detail page with updated waypoints and route.
- [ ] Within any given 5-minute time/detour bucket, suggestions are ordered by `quality_score` descending, not raw time — verified by comparing a highly-rated-but-slightly-farther place against a lower-rated-but-slightly-closer place in the same bucket.
- [ ] A place with no rating data still appears in results (sorted last within its bucket), rather than being excluded.
- [ ] Cached suggestion reads (`GET .../suggestions`) return suggestions in the same order as the discovery call that produced them.
- [ ] Radius discovery's candidate pool reflects pagination (more than ~20 results per place type when the area supports it) and excludes places below the rating/review-count floor.
- [ ] Radius discovery completes within a reasonable request timeout despite pagination (verified: paginated Nearby Search across 5 place types runs concurrently in ~2.3s; full pipeline in ~5.5s).
- [ ] Corridor discovery's latency is unaffected by the radius-mode pagination change (corridor does not paginate).

---

See also: [phase-3-point-to-point-routing.md](./phase-3-point-to-point-routing.md), [phase-4-radius-mode.md](./phase-4-radius-mode.md).
