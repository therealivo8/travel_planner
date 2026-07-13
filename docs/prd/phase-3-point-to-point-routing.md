# PRD — Phase 3: Point-to-Point Route Planning

## Overview
Implement the first core trip mode: planning a road trip from a defined start location to a defined end location, with optional stops in between. This phase adds mapping, address autocomplete, real route calculation, and an interactive map view.

## Prerequisites
- Phase 1 & 2 complete (auth, trips + waypoints CRUD, Docker stack).
- A Google Maps API key (or Mapbox token) stored in environment variables.
- Decision: **use Google Maps Platform** — Maps JavaScript API, Places API (Autocomplete), and Routes API (for driving directions). Mapbox is an acceptable alternative if the implementing team prefers it; swap the SDK but keep the same interface contracts.

## Goals
- Users can create a point-to-point trip with a real start and end address using autocomplete.
- The backend calculates the full driving route and stores leg-by-leg breakdown.
- The frontend displays the route on an interactive map with draggable waypoints.
- Drive time and total distance are surfaced clearly in the UI.

## Out of Scope
- Radius mode (Phase 4).
- Trip itinerary / day-by-day scheduling (Phase 5).
- LLM suggestions (Phase 6).
- Real-time traffic (nice-to-have, not required).

---

## Backend Requirements

### New Environment Variable
```
MAPS_API_KEY=<Google Maps server-side key>
```

### New DB Columns (via Alembic migration)

**`trips`** — add:
| Column | Type | Notes |
|---|---|---|
| `total_distance_meters` | INTEGER | calculated after route fetch |
| `total_drive_seconds` | INTEGER | calculated after route fetch |
| `route_polyline` | TEXT | encoded polyline of full route |

**`waypoints`** — add:
| Column | Type | Notes |
|---|---|---|
| `drive_seconds_from_prev` | INTEGER | leg travel time |
| `distance_meters_from_prev` | INTEGER | leg distance |
| `place_id` | VARCHAR(300) | Google Place ID (nullable) |

### New API Endpoints

#### `POST /trips/{trip_id}/calculate-route`
Triggers a route calculation from the Maps API using the trip's start, ordered waypoints, and end location. Stores results back on the trip and waypoints. Returns the updated trip object.

- Idempotent — safe to call multiple times (recalculates on each call).
- Returns 400 if trip mode is not `point_to_point`.
- Returns 400 if no end location is set.
- Calls the Google Routes API (or Directions API) with `travelMode: DRIVE`.
- Stores the encoded overview polyline on `trips.route_polyline`.
- Stores per-leg duration/distance on each waypoint's `drive_seconds_from_prev` / `distance_meters_from_prev`.
- Updates `trips.total_distance_meters` and `trips.total_drive_seconds`.

#### `GET /trips/{trip_id}/route`
Returns the current stored route data (polyline + legs) without recalculating. Returns 404 if route has never been calculated.

Response shape:
```json
{
  "trip_id": "uuid",
  "total_distance_meters": 450000,
  "total_drive_seconds": 18000,
  "route_polyline": "encoded_string",
  "legs": [
    {
      "from_waypoint_id": "uuid_or_null",
      "to_waypoint_id": "uuid_or_null",
      "distance_meters": 120000,
      "drive_seconds": 4800
    }
  ]
}
```

#### Address Geocoding proxy (optional but recommended)
`GET /geocode?q=<address>` — proxies to Google Geocoding API. Keeps the Maps API key server-side.

---

## Frontend Requirements

### New Pages
- `/trips/new` — upgraded from Phase 2 placeholder to use address autocomplete for start/end.
- `/trips/{trip_id}` — trip detail page with map and route summary.

### Components

#### `AddressAutocomplete`
- Text input that calls the Google Places Autocomplete API (or the backend proxy).
- Returns `{ address, lat, lng, place_id }` on selection.
- Used for start address, end address, and each waypoint.

#### `TripMap`
- Renders a Google Map (or Mapbox map) centered on the route.
- Draws the route polyline from `trips.route_polyline`.
- Markers for start, end, and each waypoint.
- Clicking a marker shows a popover with waypoint label, stop duration, and leg distance/time from previous stop.

#### `RouteStats`
- Displays total distance (formatted, e.g. "280 mi") and total drive time (e.g. "4 h 32 min").
- Displayed prominently above or beside the map.

#### `WaypointList`
- Ordered list of stops.
- Each stop shows: label, address, stop duration, drive time from previous stop.
- "Add stop" button opens an `AddressAutocomplete` inline.
- Drag-to-reorder (use `@dnd-kit/core`).
- Delete stop button.
- After any add/remove/reorder, automatically triggers `POST /trips/{trip_id}/calculate-route`.

### UX Flow
1. User creates a new point-to-point trip (start + end address via autocomplete).
2. Trip is saved; user lands on `/trips/{trip_id}`.
3. Route is automatically calculated on first load.
4. Map renders with route; stats show.
5. User can add/remove/reorder waypoints; map and stats update after each change.
6. User can edit the trip title and notes inline.

---

## Acceptance Criteria
- [ ] Address autocomplete works for start, end, and waypoints.
- [ ] `POST /trips/{trip_id}/calculate-route` returns a valid route for any valid US start + end.
- [ ] Route polyline renders correctly on the map.
- [ ] Total distance and drive time are accurate (within 5% of Google Maps UI for the same route).
- [ ] Adding a waypoint and triggering recalculation updates all leg times correctly.
- [ ] Reordering waypoints via drag-and-drop correctly reorders them in the DB and recalculates the route.
- [ ] Deleting a waypoint keeps `position` values contiguous.
- [ ] Maps API key is never exposed to the client (proxy pattern used).
- [ ] Calling `calculate-route` on a radius-mode trip returns 400.
- [ ] The map view is usable on a 375px wide mobile screen (responsive).

---

## Notes for the Implementing Agent
- The Google **Routes API** (v2) is preferred over the legacy Directions API — it returns `polyline.encodedPolyline` in the response.
- Store the raw Maps API response alongside the parsed fields for debugging, in a `route_raw_response` JSONB column (nullable, not returned in API responses).
- Use `@googlemaps/google-maps-services-js` in the FastAPI backend (via the Python client `googlemaps`).
- For the map on the frontend, use `@vis.gl/react-google-maps` (the official React wrapper for Google Maps).
- Debounce waypoint changes before triggering recalculation — wait 500ms after the last mutation before calling the route endpoint.
- The Maps API key used in the backend should have HTTP referrer restrictions disabled (server-to-server). Create a separate key for any client-side autocomplete widget restricted to your domain.

---

See also: [phase-7-corridor-and-itinerary-optimization.md](./phase-7-corridor-and-itinerary-optimization.md) — adds discovery of stops *along* the calculated route within a detour budget.
