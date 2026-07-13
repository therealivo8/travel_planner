# PRD — Phase 7: Corridor Stops & Itinerary Optimization

## Overview
Google Maps shows you a route. This app finds what's *worth stopping for* along that route within a detour budget you control, and builds a same-day itinerary that respects your time budget without you manually re-ordering stops. Phases 3–5 already deliver point-to-point routing and radius-mode discovery, but both stop short of real itinerary-building: point-to-point has no way to discover stops *between* the start and end, and radius mode's "select suggestions → build route" flow ignores whether the resulting round trip is actually a reasonable day. This phase closes both gaps.

## Prerequisites
- Phases 1–5 complete: auth, full CRUD, point-to-point routing, radius mode, itinerary/sharing/export.
- Runs independently of Phase 6 (LLM integration) — no Anthropic dependency — but is designed so Phase 6 can build on it (see "Phase 6 hook-in" below).

## Goals
- **Corridor stops** (point-to-point): discover POIs along the calculated route within an acceptable detour, not just near a single point.
- **Radius itinerary builder** (radius mode): order selected suggestions to minimize backtracking and validate the round trip against a time budget, dropping stops if needed rather than silently building an unreasonable day.

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
5. Filter to candidates within `max_detour_minutes`, sort by detour ascending.

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

## Phase 6 hook-in
`corridor.discover_corridor_suggestions()` takes plain geometry/numeric inputs and returns plain candidate dicts — no FastAPI or DB coupling. A future `POST /trips/{trip_id}/ai/suggest-stops` (Phase 6) is expected to call this function directly to get a geometrically-valid candidate pool along the route, then have Claude re-rank or filter it by natural-language preference, rather than reimplementing corridor search.

## Acceptance Criteria
- [ ] `POST /trips/{trip_id}/corridor/discover` returns candidates within the specified detour for a point-to-point trip with a calculated route.
- [ ] Corridor endpoints 400 on radius-mode trips, and 400 on point-to-point trips with no route yet.
- [ ] Selecting corridor stops and inserting as waypoints produces a route that still passes through start and end.
- [ ] `POST /trips/{trip_id}/radius/build-itinerary` returns an ordered itinerary whose total (drive + stop time) is within `max_drive_minutes * 2`, dropping stops if the initial selection doesn't fit.
- [ ] Radius itinerary ordering measurably reduces total drive time versus the naive distance-from-start ordering for a spread-out selection of stops.
- [ ] Both flows work end-to-end from the UI: discover → select → build → land on the trip detail page with updated waypoints and route.

---

See also: [phase-3-point-to-point-routing.md](./phase-3-point-to-point-routing.md), [phase-4-radius-mode.md](./phase-4-radius-mode.md).
