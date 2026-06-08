# Phase 4: Drive-Time Radius Mode — Implementation Notes

## What Was Built

Phase 4 adds a second trip creation mode alongside the existing point-to-point mode. Instead of entering a start and end destination, the user provides only a starting location and a maximum drive time. The app then:

1. Draws a polygon on the map representing everywhere reachable within that drive time (an **isochrone**).
2. Searches for points of interest (parks, restaurants, landmarks, towns) within that area.
3. Confirms each candidate is actually reachable within the time limit using real routing data.
4. Presents the results in a sidebar list. The user toggles which stops interest them.
5. Clicking "Build Route" assembles those stops into a **round-trip route** (start → stops → back to start) and navigates to the standard trip detail page.

---

## New Files

| File | Role |
|---|---|
| `backend/app/services/radius.py` | Discovery pipeline: isochrone, Nearby Search, Distance Matrix |
| `backend/app/api/radius.py` | FastAPI router for the four radius endpoints |
| `backend/alembic/versions/0004_phase4_radius_mode.py` | Database migration |
| `frontend/src/app/trips/[trip_id]/discover/page.tsx` | The discover page — map + sidebar |
| `frontend/src/components/routing/IsochroneLayer.tsx` | Map overlay that renders the isochrone polygon |
| `frontend/src/components/radius/SuggestionCard.tsx` | Individual POI card in the sidebar list |
| `frontend/src/components/radius/index.ts` | Barrel export for radius components |

## Modified Files

| File | What Changed |
|---|---|
| `backend/app/config.py` | Added `ors_api_key` setting |
| `backend/app/models/trip.py` | Added `radius_isochrone_geojson` column to `Trip`; added `RadiusSuggestion` model and relationship |
| `backend/app/schemas/trip.py` | Added `RadiusSuggestionOut`, `RadiusDiscoverResponse`, `RadiusSelectRequest` schemas |
| `backend/app/main.py` | Registered the radius router |
| `backend/pyproject.toml` | Added `httpx` dependency |
| `frontend/src/types/index.ts` | Added `RadiusSuggestion`, `RadiusDiscoverResponse`, `GeoJSONPolygon`, `SuggestionCategory` types |
| `frontend/src/lib/api.ts` | Added `discoverRadius`, `getRadiusSuggestions`, `selectSuggestions`, `deselectSuggestion` helpers |
| `frontend/src/components/routing/TripMap.tsx` | Added optional `layers` prop for arbitrary map overlays |
| `frontend/src/components/routing/index.ts` | Exported `IsochroneLayer` |
| `frontend/src/app/trips/new/page.tsx` | Radius trips now redirect to `/discover` instead of the detail page |
| `frontend/src/app/trips/[trip_id]/page.tsx` | Added radius-mode summary card and read-only selected stops list |

---

## Backend Deep-Dive

### The Discovery Pipeline (`services/radius.py`)

This is the core of the feature. It chains three external API calls in sequence and is called synchronously (blocking) inside the async FastAPI handler. That design choice is discussed in the trade-offs section below.

#### Stage 1 — Isochrone from OpenRouteService

```python
def fetch_isochrone(origin_lat, origin_lng, max_drive_minutes):
    max_seconds = max_drive_minutes * 60
    body = {
        "locations": [[origin_lng, origin_lat]],  # note: lng first — ORS uses [lng, lat]
        "range": [max_seconds],
        "range_type": "time",
    }
    resp = httpx.post("https://api.openrouteservice.org/v2/isochrones/driving-car", ...)
    return resp.json()["features"][0]["geometry"]
```

An isochrone is a geographic polygon whose boundary represents the farthest points you can drive from the origin in exactly `max_drive_minutes`. Everything inside the polygon is theoretically reachable within that time.

**Why OpenRouteService (ORS)?**
Google Maps has no native isochrone endpoint. The two practical alternatives are:

- **ORS (chosen):** Free tier, straightforward REST API, returns standard GeoJSON. The only friction is the coordinate order — ORS follows GeoJSON spec (`[lng, lat]`) while most of the codebase uses `(lat, lng)`. This is handled in `IsochroneLayer.tsx` where coordinates are reversed on the frontend before passing to Google Maps.
- **HERE Isoline Routing API:** Comparable quality, free tier available, but requires a separate account and returns a proprietary format that needs more transformation code.
- **Ray-casting approximation:** The PRD mentioned this as option 3 — cast N rays from the origin, call Distance Matrix along each ray to find how far you can go in the time limit, then connect the points. This would avoid an additional API dependency entirely, but the polygon quality would be poor (you'd need 36+ rays for a smooth shape) and it would consume many more Distance Matrix API calls — which are billed per element.

ORS is the correct choice here: best quality polygon, free, standard output format.

**Important detail — the coordinate flip:** ORS returns `[lng, lat]` pairs (standard GeoJSON), but Google Maps JavaScript API expects `{lat, lng}` objects. The frontend `IsochroneLayer` component handles this reversal:

```typescript
const path = geojson.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
```

If you miss this, the polygon renders mirrored across the equator or in the wrong ocean.

---

#### Stage 2 — Google Places Nearby Search

```python
def _nearby_search(gmaps, origin_lat, origin_lng, radius_meters, categories):
    for ptype in place_types[:5]:
        resp = gmaps.places_nearby(
            location={"lat": origin_lat, "lng": origin_lng},
            radius=min(radius_meters, 50000),
            type=ptype,
        )
```

The search radius is derived from the isochrone bounding box — half of the diagonal distance across the bbox, capped at 50,000 metres (the Google Places API maximum). The formula:

```python
lat_span = (max_lat - min_lat) * 111_000          # degrees → metres
lng_span = (max_lng - min_lng) * 111_000 * cos(lat)  # longitude shrinks near poles
search_radius = sqrt(lat_span² + lng_span²) / 2
```

The cosine correction on longitude is necessary because a degree of longitude is only ~111 km at the equator — it narrows to zero at the poles.

**Why search by type, not keyword?** The Places Nearby Search API requires a `type` parameter or a `keyword`. Searching by type (`park`, `tourist_attraction`, etc.) returns categorised, higher-quality results than keyword searches, and the API returns up to 20 results per request with pagination. We issue one request per type and deduplicate by `place_id`.

**The 5-type cap:** Issuing a Nearby Search per type costs one API call each. With 7 types in `_SEARCH_TYPES`, that is 7 calls per discovery. We cap at 5 types in the all-categories case to stay under typical free-tier quotas. If the user filters to a specific category (e.g. just "parks"), the cap is irrelevant because we only search the matching types.

**What Nearby Search does not do:** It searches within a circular radius from the origin — not within the isochrone polygon. A place 40 km due north might be within the circle but actually require 3 hours to reach because of a mountain range. This is exactly why Stage 3 exists.

---

#### Stage 3 — Distance Matrix confirmation filter

```python
def _distance_matrix_filter(gmaps, origin_lat, origin_lng, places, max_drive_seconds):
    for i in range(0, len(places), _MATRIX_BATCH):
        batch = places[i:i + 25]
        matrix = gmaps.distance_matrix(origins=[origin], destinations=destinations, mode="driving")
        for place, elem in zip(batch, elements):
            if elem["duration"]["value"] <= max_drive_seconds:
                confirmed.append({**place, "_drive_seconds": ..., "_distance_meters": ...})
```

This is the correctness guarantee. Every candidate from Stage 2 is sent to the Distance Matrix API to get an actual routing-based travel time. Any place that takes longer to reach than `max_drive_minutes` is dropped.

**Batching at 25:** The Distance Matrix API accepts up to 25 destinations per request (and bills per origin×destination element). With a 100-place candidate pool, this is at most 4 requests — roughly 100 API elements. The loop processes candidates in batches of 25; failed batches are silently skipped rather than aborting the whole discovery.

**Why not use the isochrone polygon for filtering instead?** You could do a point-in-polygon test on each candidate's coordinates to check if it falls inside the isochrone — no extra API call needed. This works for simple cases but fails in mountainous or coastal terrain where the isochrone polygon has irregular concavities. A place at coordinates inside the polygon might require driving around a lake, making it actually unreachable within the time limit. The Distance Matrix call uses real routing data and is the only reliable filter.

---

#### Category classification (`_TYPE_MAP`, `_classify`)

Google Places returns an array of `types` per place (e.g. `["museum", "tourist_attraction", "point_of_interest"]`). We map these to five human-readable categories that the UI understands: `park`, `restaurant`, `landmark`, `town`, `other`. The `_classify` function walks the place's types list and returns the first match found in `_TYPE_MAP`:

```python
def _classify(place):
    for t in place.get("types", []):
        if t in _TYPE_MAP:
            return _TYPE_MAP[t]
    return "other"
```

Since Google types appear in priority order (most specific first), the first match is usually the right one.

---

### Database Changes

#### New table: `radius_suggestions`

```sql
CREATE TABLE radius_suggestions (
    id          UUID PRIMARY KEY,
    trip_id     UUID REFERENCES trips(id) ON DELETE CASCADE,
    place_id    VARCHAR(300),   -- Google Place ID for deduplication
    name        VARCHAR(300),
    address     TEXT,
    lat         NUMERIC(10,7),
    lng         NUMERIC(10,7),
    category    VARCHAR(100),   -- our 5-category classification
    drive_seconds_from_start  INTEGER,
    distance_meters_from_start INTEGER,
    rating      NUMERIC(3,1),   -- Google's 1.0–5.0 rating
    selected    BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ
);
```

**Why store suggestions in the database rather than computing them on demand?**

Discovery takes 3–8 seconds (three sequential external API calls). Storing the results means:
- The discover page can reload instantly when the user navigates away and back.
- The frontend only needs to call discovery once; subsequent views use the cached data.
- The `selected` boolean on each row is the source of truth for which stops the user has chosen.

**Why not a Redis cache?** A relational table is already available, the data is naturally tied to a trip (shares the same CASCADE delete lifecycle), and it needs to be queryable by `trip_id`. A Redis key-value cache would complicate the deployment without adding meaningful performance benefit for 50-row datasets.

#### New column: `trips.radius_isochrone_geojson`

```sql
ALTER TABLE trips ADD COLUMN radius_isochrone_geojson JSONB;
```

The isochrone GeoJSON polygon is stored as JSONB directly on the `trips` row. It is fetched from ORS once and reused on every subsequent visit to the discover page. This avoids a repeated ORS API call just to redraw the map.

**Why JSONB and not TEXT?** JSONB is stored in a parsed binary form that PostgreSQL can index and query into. For the isochrone, that advantage is irrelevant since we never query into the geometry — we just read and write it whole. However, JSONB also validates that the value is valid JSON on write, which protects against storing garbage. TEXT would work equally well in practice.

---

### API Endpoints (`api/radius.py`)

All four endpoints share the same guard function `_get_radius_trip`, which loads the trip, verifies ownership, and returns a 400 if the trip mode is not `radius`. This means non-radius trips cannot accidentally hit these endpoints.

#### `POST /trips/{trip_id}/radius/discover`

Runs the full discovery pipeline. Before inserting new suggestions, it deletes all existing ones with a bulk `DELETE`:

```python
await db.execute(delete(RadiusSuggestion).where(RadiusSuggestion.trip_id == trip_id))
```

This is a deliberate replacement strategy — re-running discovery always gives a fresh set of results. An append strategy (merging new results with old ones by `place_id`) would preserve the user's `selected` state across re-runs, but was excluded from Phase 4 scope. In practice, a re-run usually means the user changed parameters or wants a fresh search, so resetting is the more predictable behaviour.

#### `GET /trips/{trip_id}/radius/suggestions`

Read-only. Returns whatever is cached in the database without calling any external API. The frontend calls this first on page load — if it returns data, discovery is skipped. If it returns an empty list, discovery is triggered automatically.

#### `POST /trips/{trip_id}/radius/select`

This is the most complex endpoint. It does four things:

1. Deselects all existing suggestions on the trip (full replacement semantics — the user's current selection replaces any prior selection).
2. Marks the requested suggestion IDs as `selected = true`.
3. If `generate_route: true`, converts selected suggestions to `Waypoint` rows ordered by ascending `drive_seconds_from_start` (nearest stops first), then calls the existing route calculation service.
4. For the round-trip, passes `dest_lat = start_lat` and `dest_lng = start_lng` — the same coordinates as the origin. Google Directions interprets this correctly as "return to start".

**Why reuse the Phase 3 `calculate_route` function?** The route calculation logic (calling the Google Directions API, parsing legs, storing polyline + per-leg timing data) is identical between point-to-point and radius modes. Reusing it means the trip detail page, which reads `route_polyline` and waypoint timing data, works for both modes without any changes.

**Ordering by drive time:** Stops are ordered by `drive_seconds_from_start` ascending, not by geographic proximity or any other metric. This is a reasonable default for a round trip — you visit closer stops before farther ones, creating an efficient outward-and-return shape. A proper travelling-salesman optimisation was not included; Google Directions does have a `optimize_waypoints` option but it is off here to give the user predictable ordering.

#### `DELETE /trips/{trip_id}/radius/suggestions/{suggestion_id}/select`

Deselects a single suggestion and removes the corresponding waypoint by matching on `place_id`. Position compaction (shifting remaining waypoints' `position` values down by one) mirrors the same logic in the Phase 3 waypoints router.

---

## Frontend Deep-Dive

### `IsochroneLayer` (`components/routing/IsochroneLayer.tsx`)

```typescript
useEffect(() => {
    const path = geojson.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
    const polygon = new google.maps.Polygon({ paths: path, fillOpacity: 0.1, ... });
    polygon.setMap(map);
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
    return () => polygon.setMap(null);   // cleanup on unmount
}, [map, geojson]);
```

This component creates a native Google Maps `Polygon` imperatively inside a `useEffect`. It is mounted inside `<TripMap>` via the `layers` prop.

**Why imperative (`new google.maps.Polygon`) rather than a declarative component?** The `@vis.gl/react-google-maps` library has a `<Polygon>` component, but at the time of writing it has limited support for the full polygon styling API. The imperative approach directly accesses the Maps JavaScript API and offers complete control. The cleanup function (`polygon.setMap(null)`) ensures the polygon is removed from the map when the component unmounts, preventing memory leaks.

**The `layers` prop on `TripMap`:** Rather than baking isochrone-specific logic into `TripMap`, a generic `layers?: React.ReactNode` prop was added. Anything passed there renders inside the `<Map>` element, giving access to the map context. This keeps `TripMap` reusable across both modes while allowing the discover page to inject its isochrone polygon and suggestion markers.

---

### The Discover Page (`app/trips/[trip_id]/discover/page.tsx`)

#### State management

The page manages all state locally with `useState`. There is no external state manager (Redux, Zustand, etc.) involved.

```typescript
const [suggestions, setSuggestions] = useState<RadiusSuggestion[]>([]);
const [isochrone, setIsochrone] = useState<GeoJSONPolygon | null>(null);
const [activeCategory, setActiveCategory] = useState<SuggestionCategory | "all">("all");
```

Selection state is maintained entirely on the frontend — toggling a suggestion calls `setSuggestions` with the `selected` boolean flipped locally. The backend is not called until the user clicks "Build Route". This matters for responsiveness: selecting and deselecting stops feels instant with no network round-trips.

**Why not persist selection to the server in real time?** The PRD's `DELETE .../select` endpoint exists for programmatic deselection (e.g. in a future itinerary view), but for the primary discover-and-build flow, optimistic local state is far better UX. A network call per tap would introduce latency and failure cases that complicate the UI.

#### The cache-or-discover pattern

```typescript
useEffect(() => {
    if (hasRunDiscovery.current) return;
    hasRunDiscovery.current = true;

    (async () => {
        const t = await loadTrip();
        if (t.mode !== "radius") { router.replace(...); return; }

        const cached = await getRadiusSuggestions(trip_id);
        if (cached.suggestions.length > 0) {
            // use cache, skip discovery
            return;
        }
        // run discovery
        await runDiscovery();
    })();
}, [...]);
```

On mount, the page first checks whether there are already cached suggestions in the database. If so, it uses them immediately — the page renders with no loading delay and no API quota consumption. Only when the cache is empty does it trigger the full discovery pipeline.

`hasRunDiscovery` is a `useRef` (not state) because it tracks an effect guard, not a value that should cause re-renders. Using state here would trigger an extra render cycle.

**Mode guard:** If someone navigates directly to `/trips/[id]/discover` for a point-to-point trip, the page detects `t.mode !== "radius"` and immediately redirects to the trip detail page. This prevents a confusing experience.

#### Category filtering (client-side)

```typescript
const visibleSuggestions =
    activeCategory === "all"
        ? suggestions
        : suggestions.filter((s) => s.category === activeCategory);
```

Category filtering is done in the browser against the already-loaded suggestion list. The backend does support a `categories[]` query parameter for server-side filtering during discovery, but once suggestions are loaded, filtering is instant in the browser and avoids an additional network call.

**When server-side filtering is used:** The "Re-run discovery" button passes no category filter, always fetching all categories. If a future enhancement wanted to let users search specifically for only parks (to reduce API billing on the Distance Matrix filter stage), passing categories to the `POST .../discover` call would accomplish that.

#### Mobile layout

On screens narrower than `sm` (640px), the page shows either the map or the list, toggled by a button in the header. When the map is visible with selections made, a floating "Build Route" button appears fixed at the bottom of the screen.

On desktop (`sm` and wider), the page uses a 3-column grid: the map takes 2 columns and the sidebar takes 1.

**Why a toggle instead of a bottom sheet?** A bottom sheet (drawer that slides up over the map) is a common pattern for this type of UI. The `sheet.tsx` component was imported and then removed because the toggle approach is simpler to implement correctly — bottom sheets require careful handling of drag gestures and their interactions with the map's own touch handling. For Phase 4, toggle was the pragmatic choice.

---

### `SuggestionCard` (`components/radius/SuggestionCard.tsx`)

```typescript
<button type="button" onClick={() => onToggle(suggestion.id)}
    className={cn(
        "rounded-xl border-2 ...",
        suggestion.selected ? "border-primary-500 bg-primary-50" : "border-neutral-200 ..."
    )}
>
```

The card is a `<button>` element rather than a `<div>` with an `onClick`. This is a deliberate accessibility choice — buttons are keyboard-navigable and screen-reader-announced as interactive controls by default. A `<div>` with an `onClick` handler requires additional ARIA attributes (`role="button"`, `tabIndex`, keyboard event handlers) to meet the same accessibility standard.

The `formatDriveTime` helper converts seconds into `"1h 45m"` or `"35m"` format, handling the case where minutes or hours are zero.

The `CATEGORY_META` lookup table decouples the category string from its display properties (icon component, color class, label). Adding a new category in the future only requires one entry in this table.

---

## Trade-offs and Known Limitations

### Discovery runs synchronously (blocking)

The `discover_suggestions` function is a regular synchronous Python function called with `await` inside FastAPI. This works because FastAPI runs sync functions in a thread pool automatically. However, the three external HTTP calls (ORS, Places, Distance Matrix) run sequentially, not concurrently. Total wall time can be 5–10 seconds for a typical request.

**A faster alternative** would be to make `discover_suggestions` an `async` function and use `asyncio.gather` to parallelize where possible — for example, running Distance Matrix batches concurrently. This was not implemented because the gain is modest (Distance Matrix batches are already grouped into 4 requests for ~100 places), and the added complexity of async error handling in the service layer is not worth it at this stage.

### Places Nearby Search does not respect the isochrone boundary

The search circle is derived from the isochrone's bounding box, but it is still a circle. Places near the corners of the bounding box might be outside the isochrone polygon but inside the search circle. The Distance Matrix filter catches all of these — they will have a drive time exceeding the limit and will be excluded. This means the Places search sometimes fetches places that will be thrown away, consuming API quota unnecessarily. For most real-world isochrones (which are roughly circular), this waste is small.

A point-in-polygon pre-filter (check if the candidate's lat/lng is inside the isochrone GeoJSON polygon) would eliminate some of this waste without an extra API call. It was not implemented because the geometry code is non-trivial and the Distance Matrix filter already handles correctness.

### The `selected` boolean is reset on re-discovery

When the user clicks "Re-run discovery", all existing suggestions are deleted and replaced. Any stops the user had selected are cleared. This is the simplest correct behaviour — the new result set may not contain the same places (or they may have different IDs), so there is no reliable way to re-apply the old selection. In practice, users re-run discovery when they want a genuinely fresh search, so this is acceptable. A future improvement could preserve selections by matching on `place_id`.

### Round-trip ordering is by drive time from start, not optimised

Selected stops are ordered by ascending `drive_seconds_from_start`. This produces a reasonable route (visit nearby stops before far ones) but is not optimal — a true travelling-salesman solution might save significant driving time for trips with many stops spread in different directions. Google Directions' `optimize_waypoints: true` would solve this but was not enabled because it changes the stop order without user confirmation, which could be confusing.

### ORS free tier limits

OpenRouteService's free tier allows 500 requests/day and 40 requests/minute. For a low-traffic application this is fine. If you expect heavy usage, you would need a paid ORS plan or to implement request caching at a coarser level (e.g. cache isochrones by `(lat, lng, max_minutes)` in Redis or a database table, reusing results for identical parameters rather than calling ORS on every discovery).

### Discovery is not background/async from the user's perspective

The discover endpoint is a synchronous HTTP request that the frontend `awaits`. The UI shows a skeleton loading state and a spinner, but the user cannot do anything else while waiting. A more sophisticated approach would use a background job queue (Celery, ARQ) — the frontend would start a job, poll for completion, and be free to interact with the page in the meantime. That architecture adds significant complexity (a task queue, a worker process, a WebSocket or polling mechanism) and is not appropriate for Phase 4.

---

## Environment Variables Required

| Variable | Where to Get It | Notes |
|---|---|---|
| `ORS_API_KEY` | openrouteservice.org → sign up → API key | Free tier: 500 req/day |
| `MAPS_API_KEY` | Google Cloud Console → Maps JavaScript API | Required since Phase 3; also used here for Places and Distance Matrix |

Add both to `backend/.env`. The ORS key is never sent to the frontend.
