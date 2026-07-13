# PRD — Phase 4: Drive-Time Radius Mode

## Overview
Implement the second core trip mode: the user provides only a starting location and a maximum drive time, and the app discovers destinations reachable within that radius. The app presents suggested destinations (points of interest, towns, parks, etc.) and lets the user select stops to build an outbound + return route.

## Prerequisites
- Phase 1–3 complete (full stack, auth, point-to-point routing, Maps integration).
- Google Maps API key already wired in — this phase adds the **Isochrone / Distance Matrix API** and **Places API (Nearby Search)**.

## Goals
- Users can enter a start location + max drive time and see a visual isochrone (drive-time boundary) on the map.
- The app surfaces POI suggestions (restaurants, parks, landmarks, towns) within the reachable area.
- Users can select suggestions to add as waypoints, then generate a round-trip or one-way route back through selected stops.
- The radius mode trip flows naturally into the same trip detail page used in Phase 3.

## Out of Scope
- Point-to-point routing (Phase 3).
- Itinerary scheduling (Phase 5).
- LLM-powered recommendations (Phase 6).

---

## Concepts

### Isochrone
A polygon representing the area reachable within a given drive time from the origin. Google Maps does not have a native isochrone API, so this is approximated using one of:
1. **OpenRouteService (ORS) Isochrones API** (free tier, REST) — recommended.
2. **HERE Isoline Routing API** — alternative.
3. Approximation: cast N rays from the origin, use Distance Matrix to find the reachable distance along each ray, then connect the points.

The implementing agent should use **OpenRouteService** as the default. Add `ORS_API_KEY` to the environment.

### POI Discovery
Use Google Places API **Nearby Search** centered on the origin, filtered by the isochrone bounding box, and filtered to only return places whose driving distance (from the Distance Matrix API) is within `max_drive_minutes`.

---

## Backend Requirements

### New Environment Variables
```
ORS_API_KEY=<OpenRouteService key>
```

### New DB Table: `radius_suggestions`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `trip_id` | UUID FK → trips.id | ON DELETE CASCADE |
| `place_id` | VARCHAR(300) | Google Place ID |
| `name` | VARCHAR(300) | |
| `address` | TEXT | |
| `lat` | NUMERIC(10,7) | |
| `lng` | NUMERIC(10,7) | |
| `category` | VARCHAR(100) | e.g. 'park', 'restaurant', 'landmark' |
| `drive_seconds_from_start` | INTEGER | |
| `distance_meters_from_start` | INTEGER | |
| `rating` | NUMERIC(3,1) | Google Places rating |
| `selected` | BOOLEAN | default false — user has added to trip |
| `created_at` | TIMESTAMPTZ | |

### New API Endpoints

#### `POST /trips/{trip_id}/radius/discover`
Triggers the full discovery pipeline:
1. Fetches the isochrone polygon from ORS for `(start_lat, start_lng, max_drive_minutes)`.
2. Runs a Google Nearby Search within the isochrone bounding box.
3. Filters results using the Distance Matrix API to confirm each is within `max_drive_minutes` of driving time.
4. Upserts results into `radius_suggestions`.
5. Returns the list of suggestions.

- Returns 400 if trip mode is not `radius`.
- Returns 400 if `max_drive_minutes` is not set.
- Capped at 50 suggestions per call; supports `categories[]` query param to filter by place type.

Response:
```json
{
  "isochrone_geojson": { "type": "Polygon", "coordinates": [...] },
  "suggestions": [
    {
      "id": "uuid",
      "name": "Shenandoah National Park",
      "address": "...",
      "lat": 38.5,
      "lng": -78.4,
      "category": "park",
      "drive_seconds_from_start": 5400,
      "rating": 4.8,
      "selected": false
    }
  ]
}
```

#### `GET /trips/{trip_id}/radius/suggestions`
Returns cached suggestions + isochrone. Does not re-run discovery.

#### `POST /trips/{trip_id}/radius/select`
Body: `{ "suggestion_ids": ["uuid", ...], "generate_route": true }`

Marks the given suggestions as `selected = true` and (if `generate_route` is true) converts them to waypoints on the trip and calls the route calculation logic (same as Phase 3 `calculate-route`), building a round-trip route: start → selected stops (ordered by drive time from start) → start.

#### `DELETE /trips/{trip_id}/radius/suggestions/{suggestion_id}/select`
Deselects a suggestion; removes the corresponding waypoint from the trip.

---

## Frontend Requirements

### New Page Flow
`/trips/new` → mode selector → if radius: enter start + max drive time → submit → `/trips/{trip_id}/discover`

#### `/trips/{trip_id}/discover` (new page)
Shows:
- The isochrone boundary drawn on the map as a semi-transparent polygon.
- POI markers inside the isochrone, color-coded by category.
- A sidebar listing suggestions with name, category, drive time, and rating.
- Category filter chips (All / Parks / Food / Landmarks / etc.).
- "Select" button per suggestion (toggles selected state).
- A floating "Build Route" button (enabled when ≥1 suggestion selected).
- Clicking "Build Route" calls `POST /trips/{trip_id}/radius/select` with `generate_route: true`, then navigates to `/trips/{trip_id}` (the map + route view from Phase 3).

### `IsochroneLayer` Component
- Renders the GeoJSON polygon on the map as a semi-transparent fill.
- Reuses the `TripMap` component from Phase 3; add a `layers` prop for optional overlays.

### `SuggestionCard` Component
- Name, category icon, star rating, drive time badge.
- Visual selected state (border highlight, checkmark).

### UX Considerations
- Discovery can take 3–8 seconds — show a loading skeleton / progress indicator.
- Allow users to re-run discovery with different `max_drive_minutes` without leaving the page.
- On mobile, the sidebar should collapse into a bottom sheet.

---

## Acceptance Criteria
- [ ] `POST /trips/{trip_id}/radius/discover` returns a valid isochrone polygon and ≥1 suggestion for any major US city with `max_drive_minutes = 120`.
- [ ] All suggestions returned are confirmed to be within the specified drive time (no suggestions that require more driving time than the limit).
- [ ] Isochrone polygon renders on the map.
- [ ] Category filter correctly hides/shows markers and list items.
- [ ] Selecting 3 suggestions and clicking "Build Route" produces a valid round-trip route.
- [ ] The resulting route is viewable on the standard trip detail page from Phase 3.
- [ ] Re-running discovery clears previous suggestions before inserting new ones.
- [ ] Mode = `point_to_point` trips return 400 on all radius endpoints.
- [ ] ORS API key is never exposed to the frontend.
- [ ] Works on mobile (375px wide) with bottom-sheet sidebar.

---

## Notes for the Implementing Agent
- ORS Isochrones endpoint: `POST https://api.openrouteservice.org/v2/isochrones/driving-car` with `{"locations": [[lng, lat]], "range": [max_seconds]}`.
- Use the isochrone bounding box (`bbox`) to limit the Google Nearby Search radius, then post-filter with the Distance Matrix API.
- Distance Matrix calls are billed per element; batch up to 25 destinations per call.
- The `selected → waypoint` conversion should reuse the waypoint creation logic from Phase 2, ordering stops by ascending `drive_seconds_from_start`.
- For the round-trip, append the trip's start location as the final waypoint before calling the route calculation.
- Cache the isochrone GeoJSON in a `radius_isochrone_geojson` JSONB column on the `trips` table to avoid re-fetching.

---

See also: [phase-7-corridor-and-itinerary-optimization.md](./phase-7-corridor-and-itinerary-optimization.md) — adds a time-budgeted itinerary optimizer on top of selected suggestions, instead of a naive unordered round trip.
