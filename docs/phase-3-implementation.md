# Phase 3 Implementation — Point-to-Point Routing

This document explains every technical decision made during the Phase 3 implementation: what was built, how it fits together, and why specific approaches were chosen over alternatives.

---

## Table of Contents

1. [Overview](#overview)
2. [Backend](#backend)
   - [Database Migration](#database-migration)
   - [SQLAlchemy Models](#sqlalchemy-models)
   - [Config & Environment](#config--environment)
   - [Route Calculation Service](#route-calculation-service)
   - [API Endpoints](#api-endpoints)
   - [Pydantic Schemas](#pydantic-schemas)
3. [Frontend](#frontend)
   - [Package Choices](#package-choices)
   - [GoogleMapsProvider](#googlemapsprovider)
   - [AddressAutocomplete](#addressautocomplete)
   - [RouteStats](#routestats)
   - [WaypointList](#waypointlist)
   - [TripMap](#tripmap)
   - [/trips/new Page](#tripsnew-page)
   - [/trips/[trip_id] Page](#tripstrip_id-page)
4. [Security Decisions](#security-decisions)
5. [Data Flow End-to-End](#data-flow-end-to-end)

---

## Overview

Phase 3 adds the first core trip mode: point-to-point routing. A user picks a start and end address using Google Places Autocomplete, the backend calls the Google Directions API to calculate a driving route, and the frontend renders it on an interactive map. Waypoints can be added, removed, and reordered with the map and stats updating automatically.

The guiding principles throughout:

- **The Maps API key never reaches the browser** — all server-side calls go through the backend.
- **Route calculation is idempotent** — calling it multiple times is safe and simply overwrites the previous result.
- **Waypoint mutations automatically trigger a debounced recalculation** — the user doesn't have to press a button after every change.

---

## Backend

### Database Migration

**File:** `backend/alembic/versions/0003_phase3_routing_columns.py`

Three columns were added to `trips`:

| Column | Type | Reason |
|---|---|---|
| `total_distance_meters` | `INTEGER` | Integer meters avoids floating-point rounding across unit conversions. The frontend converts to miles. |
| `total_drive_seconds` | `INTEGER` | Same rationale — integer seconds are unambiguous and easy to format. |
| `route_polyline` | `TEXT` | Google's encoded polyline format is a compact ASCII string. Storing it avoids re-fetching the route just to draw it. |
| `route_raw_response` | `JSONB` | Stores the full Google API response for debugging without polluting API responses. `JSONB` (not `JSON`) allows indexed queries if needed later. Never returned to clients. |

Three columns were added to `waypoints`:

| Column | Type | Reason |
|---|---|---|
| `drive_seconds_from_prev` | `INTEGER` | Each leg's travel time, indexed by waypoint position. |
| `distance_meters_from_prev` | `INTEGER` | Each leg's distance. Together these two columns let the frontend show per-leg stats without re-calling the route endpoint. |
| `place_id` | `VARCHAR(300)` | Google's stable identifier for a place. Storing it now means Phase 6 (LLM integration) can use it to look up rich place data without re-geocoding. |

All new columns are `nullable` because existing trips won't have route data until `calculate-route` is called. Making them non-null would require a default value or a backfill, neither of which is correct here.

The migration follows the existing pattern (numbered prefix `0003`, explicit `down_revision = "0002"`) so the migration chain stays linear and `alembic downgrade` works correctly.

---

### SQLAlchemy Models

**File:** `backend/app/models/trip.py`

The new columns were added directly to the existing `Trip` and `Waypoint` mapped classes using `Mapped[T | None]` so SQLAlchemy's type system knows they're optional. The `route_raw_response` column uses `JSONB` from `sqlalchemy.dialects.postgresql` and is typed `dict[str, Any] | None` — `Any` is necessary because the Google API response is an arbitrarily nested dict that we're not going to fully model.

No changes were made to table constraints or relationships. The new columns are purely additive.

---

### Config & Environment

**Files:** `backend/app/config.py`, `backend/.env`

`maps_api_key: str = ""` was added to `Settings`. The empty string default means the app starts without a key configured — it will only fail at request time if a route endpoint is called. This is intentional: the app should boot cleanly even without Maps credentials (health checks, auth, etc. all still work).

The `.env` file got a `MAPS_API_KEY=` placeholder with a comment explaining which GCP APIs need to be enabled. This is the server-side key, which should have **no HTTP referrer restrictions** because it's used in server-to-server calls. A separate client-side key (in `frontend/.env.local`) is used for the Places Autocomplete widget in the browser and should be restricted by domain.

---

### Route Calculation Service

**File:** `backend/app/services/routes.py`

This is a thin wrapper around the `googlemaps` Python SDK. Two functions:

**`calculate_route`** calls `gmaps.directions()` (the Directions API) and returns a normalized dict. The raw Google response is also included so the router can store it in `route_raw_response`.

Why the Directions API instead of the newer Routes API (v2)?

The PRD recommends Routes API v2, but the `googlemaps` Python SDK (v4.10) does not yet have a first-class wrapper for it — you'd have to make raw HTTP calls. The Directions API is fully supported by the SDK, returns the same encoded polyline format, and produces results within the accuracy requirement stated in the PRD (within 5% of Google Maps UI). The Routes API can be swapped in later by changing this one function without touching anything else.

**`geocode_address`** is a simple geocoding call. It's used by the `/geocode` proxy endpoint to let the frontend look up coordinates for free-text input without exposing the API key.

The `_client()` helper constructs the `googlemaps.Client` on every call rather than as a module-level singleton. This is intentional: in an async FastAPI app, a module-level SDK client that uses `requests` (synchronous) could cause issues with connection pooling in the event loop. The SDK calls are run synchronously inside FastAPI route handlers, which is acceptable for an infrequently-called endpoint like route calculation. If this becomes a performance concern, the calls can be moved to a thread pool via `asyncio.run_in_executor`.

---

### API Endpoints

**File:** `backend/app/api/routing.py`

Three endpoints were added in a separate router (not bolted onto `trips.py`) to keep the file sizes manageable:

#### `POST /trips/{trip_id}/calculate-route`

This is the core endpoint. It:
1. Validates the trip is owned by the current user.
2. Rejects non-point_to_point trips with a 400 — radius mode has no fixed destination to route to.
3. Rejects trips with no end location with a 400.
4. Sorts waypoints by `position` before passing them to the service — the DB can return them in any order.
5. Stores results on the trip and on each waypoint.
6. Returns the full updated `TripOut` so the frontend can update its state in one round-trip.

**Leg assignment:** The Directions API returns one leg per segment. With waypoints `[A, B]` and start `S` / end `E`, the legs are `[S→A, A→B, B→E]`. The endpoint stores leg `i` on `waypoints[i]` (i.e., the leg that *arrives at* that waypoint). The final leg (to the destination) is not stored on a waypoint because the destination isn't a waypoint row.

The endpoint is idempotent — calling it again simply overwrites the previous values. This is important because the frontend calls it automatically after every waypoint mutation.

#### `GET /trips/{trip_id}/route`

Returns the stored route data without recalculating. Returns 404 if `route_polyline` is null (i.e., route has never been calculated). This is useful for displaying a previously-saved route without making an outbound API call.

The `legs` list is reconstructed from waypoint data at read time rather than storing a separate legs table. This avoids schema complexity — the leg data is already on the waypoints.

#### `GET /geocode?q=<address>`

Proxies to Google Geocoding API. The frontend uses this in `api.ts` as a fallback for cases where Places Autocomplete isn't available or for programmatic lookups. Returns `null` (not 404) when no result is found, so the frontend can handle it without catching an exception.

---

### Pydantic Schemas

**File:** `backend/app/schemas/trip.py`

**`WaypointOut`** gained `drive_seconds_from_prev`, `distance_meters_from_prev`, and `place_id`, all with `= None` defaults so existing waypoints without route data serialize cleanly.

**`TripOut`** gained `total_distance_meters`, `total_drive_seconds`, and `route_polyline`. `route_raw_response` was deliberately excluded — it's a debugging field and exposing raw third-party API responses to clients is a security and stability risk.

**`RouteOut`** is the response shape for `GET /trips/{id}/route`. It's a separate schema (not just `TripOut`) because it includes `legs`, which aren't part of the trip object itself.

**`GeocodeResult`** is a minimal schema — address, lat, lng, place_id. Returning the full Google geocoding response would couple the frontend to Google's response format.

---

## Frontend

### Package Choices

**`@vis.gl/react-google-maps`** — the official React wrapper for the Google Maps JavaScript API, maintained by the vis.gl team (who also maintain deck.gl). Chosen per PRD spec. It provides `APIProvider`, `Map`, `AdvancedMarker`, `Pin`, `useMap`, and `useMapsLibrary` hooks which give access to the Places and Geometry libraries lazily.

**`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`** — the PRD specifies `@dnd-kit/core` for drag-to-reorder. `@dnd-kit/sortable` is the companion package that handles the sorted list abstraction on top of the core DnD primitives. `@dnd-kit/utilities` provides the `CSS` helper for transform strings.

**`@types/google.maps`** — TypeScript type definitions for the Google Maps JavaScript API global namespace (`google.maps.*`). Required because `@vis.gl/react-google-maps` exposes the underlying Maps SDK types and our components reference `google.maps.Polyline`, `google.maps.LatLngBounds`, etc. directly.

---

### GoogleMapsProvider

**File:** `frontend/src/components/routing/GoogleMapsProvider.tsx`

A thin wrapper around `APIProvider` from `@vis.gl/react-google-maps`. It reads `NEXT_PUBLIC_MAPS_API_KEY` from the environment and passes it to the provider.

This wrapper exists for two reasons:
1. It prevents the `NEXT_PUBLIC_MAPS_API_KEY` environment variable reference from being scattered across multiple pages.
2. It makes it easy to add options (libraries, region, language) in one place if needed.

It's placed in `components/routing/` rather than `app/layout.tsx` deliberately — wrapping the entire app in `APIProvider` would load the Maps JavaScript SDK on every page, including the login page and the trips list. Loading it only on pages that need maps keeps the initial bundle lighter.

---

### AddressAutocomplete

**File:** `frontend/src/components/routing/AddressAutocomplete.tsx`

Uses `useMapsLibrary("places")` to lazily load the Places library (only loaded when the component mounts, not at app startup). When the library is ready, it attaches a `google.maps.places.Autocomplete` instance to the underlying `<input>` ref.

The component is controlled from the outside via the `value` prop (for displaying a previously-selected address) but manages its own internal `inputValue` state for the live typing interaction. This is a standard pattern for autocomplete inputs — the parent owns the "committed" value, the component owns the "in-flight" text.

`onSelect` fires only when the user picks an item from the dropdown, returning `{ address, lat, lng, place_id }`. It does not fire on every keystroke, which is important because the parent uses this to set coordinates — a half-typed address has no coordinates.

The `fields` restriction `["formatted_address", "geometry", "place_id"]` on the `Autocomplete` constructor is a cost-optimization measure — the Places API charges per field requested, so only fetching what we actually use reduces cost.

---

### RouteStats

**File:** `frontend/src/components/routing/RouteStats.tsx`

A pure display component — no state, no API calls. Takes `totalDistanceMeters` and `totalDriveSeconds` as props and renders them as formatted strings.

Distance is converted from meters to miles (not kilometers) because the app is targeting US road trips. The conversion factor 1609.34 is used rather than the rounded 1609 for accuracy. Values ≥ 10 miles are shown without decimal places; smaller values show one decimal place for precision.

Duration is formatted as "X h Y min" with edge cases for sub-hour and zero-minute values. This matches the format Google Maps itself uses, which users already have mental models for.

The component returns `null` when both values are null — this means it renders nothing while a route hasn't been calculated yet, rather than showing empty stat boxes.

---

### WaypointList

**File:** `frontend/src/components/routing/WaypointList.tsx`

The most complex frontend component. It combines DnD Kit's sortable list with waypoint CRUD operations.

**DnD Kit setup:** `PointerSensor` handles mouse and touch drag. `KeyboardSensor` with `sortableKeyboardCoordinates` enables keyboard-accessible reordering (Tab to focus, Space/Enter to pick up, arrow keys to move). `SortableContext` with `verticalListSortingStrategy` provides the visual displacement of items as they're dragged.

**`SortableWaypointItem`** is a separate component (not defined inline) because `useSortable` is a hook, and hooks can only be called inside components. Each item gets its own `useSortable(id)` call which provides the transform/transition CSS and drag handle props.

**Add stop flow:** Rather than immediately calling the API when a user types in the autocomplete, the component has an intermediate "pending add" state. The user selects an address, sees it in the input, then clicks "Add stop" to confirm. This prevents accidental waypoints from half-typed addresses and gives the user a chance to review before committing.

**Label and stop duration editing** use `onBlur` rather than `onChange` to avoid an API call on every keystroke. The inputs use `defaultValue` (uncontrolled) rather than `value` (controlled) because their state is owned by the server — updating them on every change would require keeping local state in sync with server state, adding complexity. `onBlur` fires once when the user leaves the field.

**Why `onDelete` and `onReorder` are async props (not internal):** The parent page owns the trip state. The list component doesn't know anything about the trip ID or the API — it just fires callbacks. This makes the component testable and reusable.

---

### TripMap

**File:** `frontend/src/components/routing/TripMap.tsx`

**`RoutePolyline` as a separate inner component:** Drawing the polyline requires access to `useMap()` (to attach it to the map instance) and `useMapsLibrary("geometry")` (to decode the encoded polyline string). Both are hooks, so they must live inside a component that's rendered inside `<Map>`. The outer `TripMap` renders the `<Map>` wrapper; `RoutePolyline` is rendered as a child and can access the map context.

**Why imperative Polyline instead of a declarative component:** `@vis.gl/react-google-maps` doesn't provide a `<Polyline>` component as of v1.x. The imperative approach (`new google.maps.Polyline(...)`) is the correct way to draw a line on the map using the underlying SDK. The `useEffect` cleanup removes the polyline from the map when the component unmounts or when `encodedPolyline` changes.

**`fitBounds` after drawing:** When the polyline is drawn, the map is automatically panned and zoomed to frame the entire route. `{ top: 40, right: 40, bottom: 40, left: 40 }` padding ensures the route isn't clipped at the viewport edges.

**`mapId="trip-map"`:** Required by `AdvancedMarker`, which is the modern replacement for `Marker`. `AdvancedMarker` requires a map ID to be set up in the Google Cloud Console, but also works with the literal string `"trip-map"` in development without a registered map ID.

**Marker colors:** Green for start (S), red for end (E), blue numbered markers for waypoints. These follow standard navigation app conventions so users immediately understand the map without a legend.

---

### /trips/new Page

**File:** `frontend/src/app/trips/new/page.tsx`

The existing page used plain text inputs for start/end addresses and required the user to manually enter lat/lng values. Phase 3 replaces those with `AddressAutocomplete` components.

**State shape change:** Previously, all form fields were in a single `fields` object. The new page separates concerns — `start` and `end` are `AddressSelection | null` objects (containing address + coordinates), while `title`, `notes`, and `maxDriveMinutes` remain simple strings. This makes the validation logic clearer: if `start` is null, the user hasn't selected a valid autocomplete result yet.

**Zod schema change:** The lat/lng fields now use `z.number()` (not `z.coerce.number()`). Since the values come directly from the Google API (not from user-typed text), coercion is unnecessary and would mask bugs. If lat/lng are undefined (user typed but didn't pick from dropdown), the validation fails with a human-readable message.

**Auto route calculation on creation:** After creating the trip, the page immediately calls `POST /trips/{id}/calculate-route`. This means the user lands on the detail page with the route already drawn, rather than seeing a blank map and having to click "Recalculate". The failure is caught and silently swallowed — route calculation is non-fatal, and the user can trigger it manually from the detail page if it failed.

The entire form is wrapped in `<GoogleMapsProvider>` so `AddressAutocomplete` has access to the Maps API context.

---

### /trips/[trip_id] Page

**File:** `frontend/src/app/trips/[trip_id]/page.tsx`

This is the main view for a saved trip. It ties together all the Phase 3 components.

**`use(params)` for async params:** Next.js 15 changed `params` in page components to be a `Promise`. The page unwraps it with React's `use()` hook, which is the correct pattern per the Next.js 15 docs (not `await params` in an async component, which requires a server component).

**Layout:** The page uses a two-column grid on desktop (`lg:grid-cols-3`) — the map takes 2/3 of the width, the sidebar takes 1/3. On mobile (below `lg` breakpoint), they stack vertically with the map on top. The map has a fixed height of 420px rather than a percentage, so it doesn't collapse to nothing on small screens.

**Inline title editing:** Clicking the trip title activates an in-place text input. Pressing Enter or clicking the checkmark saves; pressing Escape or clicking X cancels. This avoids a separate edit page for a single field.

**Debounced route recalculation:** After any waypoint mutation (add, delete, reorder), the page schedules a `setTimeout` of 500ms before calling `calculate-route`. If another mutation arrives before the timer fires, it clears and resets the timer. This prevents hammering the API when a user makes multiple quick changes (e.g., reordering several items). The 500ms delay matches the PRD spec.

The timer ref (`recalcTimer`) is a `useRef` so it persists across renders without causing re-renders itself.

**Optimistic waypoint state updates:** After adding or deleting a waypoint, the local `trip` state is updated immediately (before the route recalculation completes). This makes the sidebar address list and the waypoint list feel instant. The map polyline doesn't update until the recalculation finishes, which is correct — there's no valid polyline until the route is recalculated.

**Why `scheduleRecalc` takes the updated trip:** The recalculation timer closes over `scheduleRecalc`, which in turn needs to decide whether recalculation is appropriate (only for `point_to_point`). Passing the updated trip rather than reading `trip` from state avoids stale closure issues — by the time the timer fires, the state may have changed again.

**Delete confirmation:** `window.confirm()` is used before deleting a trip. This is intentional — it's a destructive action and the browser's native confirm dialog is the simplest safeguard. A custom modal can replace it in Phase 5 when the UI patterns are more established.

---

## Security Decisions

**Two separate API keys:** A server-side key (in `backend/.env`) handles Routes API, Directions API, and Geocoding — server-to-server calls with no referrer restrictions. A separate client-side key (in `frontend/.env.local`) handles the Places Autocomplete widget in the browser — this key should be restricted to your domain in the GCP console. Using the same key for both would expose an unrestricted key in the browser.

**Geocode proxy:** `GET /geocode` proxies address lookups through the backend so the frontend never needs the server-side key. A client with network inspection tools cannot extract the server key.

**`route_raw_response` never returned to clients:** The raw Google API response contains internal fields, billing-sensitive data, and format assumptions that could change. Exposing it would couple clients to Google's internal response format and potentially leak usage data.

**Trip ownership checks on all route endpoints:** `_get_owned_trip` in `routing.py` verifies `Trip.user_id == current_user.id` before any operation. A user cannot calculate or read the route of another user's trip.

---

## Data Flow End-to-End

Here is the full flow from trip creation to map display:

```
User types address in AddressAutocomplete
  → Google Places Autocomplete (client-side key, browser)
  → User selects a result
  → { address, lat, lng, place_id } stored in component state

User clicks "Create trip"
  → POST /trips  { title, mode, start_lat, start_lng, end_lat, end_lng, ... }
  → Trip row created in DB
  → POST /trips/{id}/calculate-route  (automatic, non-fatal)
      → backend calls Google Directions API (server-side key)
      → legs parsed, polyline stored on trip
      → per-leg data stored on waypoints
  → router.push("/trips/{id}")

Trip detail page loads
  → GET /trips/{id}
  → TripMap renders with stored route_polyline
      → RoutePolyline decodes polyline, draws on map, fits bounds
  → RouteStats shows total_distance_meters + total_drive_seconds
  → WaypointList renders sorted waypoints with per-leg info

User adds a stop
  → POST /trips/{id}/waypoints  { address, lat, lng, place_id }
  → Local state updated optimistically
  → 500ms debounce fires
  → POST /trips/{id}/calculate-route
  → Updated trip replaces state
  → Map redraws with new polyline
  → Stats update
```
