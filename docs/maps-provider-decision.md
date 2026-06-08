# Maps Provider Decision: Google Maps Platform

## Decision

**Staying with Google Maps Platform for all map services.**

Mapbox was evaluated as a cost-saving alternative but does not support hard spending caps or quota limits at the API level. Google Cloud Console allows per-API daily quota limits and billing alerts, which provides meaningful cost control for a side project where runaway usage would otherwise go unchecked.

---

## Why Mapbox Was Ruled Out

Mapbox bills on usage with no mechanism to hard-cap spend — if traffic spikes, the bill spikes. Google Cloud offers:

- **Per-API quota limits** — set a daily request ceiling per API (e.g. cap Directions at 500 requests/day)
- **Billing alerts** — email/SMS when spend crosses a threshold
- **$200/month free credit** — covers substantial hobby traffic before any charges

For a project at this stage, predictable billing control outweighs Mapbox's marginally cheaper per-request rates.

---

## Current Google API Usage (Unchanged)

| API | Where | Billed on |
|---|---|---|
| Maps JavaScript API | Frontend — map render | Every page with a map |
| Places API (New) — Autocomplete | Frontend — `AddressAutocomplete.tsx` | Every address search |
| Directions API | `backend/app/services/routes.py:35` | Every route calculation |
| Geocoding API | `backend/app/services/routes.py:73` | Every address → lat/lng lookup |
| Places Nearby Search | `backend/app/services/radius.py:129` | Every radius discovery |
| Distance Matrix | `backend/app/services/radius.py:163` | Every radius discovery (batches of 25) |
| Isochrone | OpenRouteService (separate key) | Every radius discovery |

---

## Recommended Google Cloud Quota Setup

Set these limits in **Google Cloud Console → APIs & Services → [API name] → Quotas**:

| API | Suggested daily cap | Rationale |
|---|---|---|
| Maps JavaScript API | 1,000 map loads | ~33/day avg, cap at 30× |
| Places API | 500 requests | Covers autocomplete + Nearby Search |
| Directions API | 200 requests | One per route build |
| Geocoding API | 200 requests | Fallback only |
| Distance Matrix | 2,500 elements | ~25 radius sessions/day |

Set a **billing alert at $10/month** as an early warning before hitting meaningful spend.

---

## Remaining ORS Dependency

The isochrone (drive-time polygon) still uses **OpenRouteService**, which has the same no-hard-cap problem as Mapbox. Options:

1. **Keep ORS** — free tier is 2,000 requests/day which is generous for hobby use; monitor manually
2. **Replace with Google** — Google does not have an isochrone API natively; would require computing an approximation from Distance Matrix results (complex, higher cost)
3. **Self-host ORS** — open source, can run on a small VPS if ORS billing becomes a concern

For now, ORS is fine. The `ORS_API_KEY` env var stays in place.

---

## Google Places Reviews (Future Enhancement)

Review data can be added to the radius discovery flow using the **Google Places Details API**, called lazily when a user interacts with a suggestion card.

**Proposed backend endpoint:**
```
GET /api/radius/place/{place_id}/details
```

Calls:
```
GET https://maps.googleapis.com/maps/api/place/details/json
    ?place_id={place_id}
    &fields=rating,user_ratings_total,reviews
    &key={MAPS_API_KEY}
```

Cost: $17 / 1,000 requests — triggered on demand, not during discovery bulk calls.

**Frontend:** `SuggestionCard` would expand on click to show full rating breakdown and up to 5 review snippets. The `rating` field already exists on `RadiusSuggestion` from Nearby Search results; this would add `user_ratings_total` and review text.

Set a quota cap on Place Details separately from Nearby Search to isolate its cost.
