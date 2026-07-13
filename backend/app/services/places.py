"""Shared Google Maps Platform helpers: client construction, Places Nearby Search,
place classification, and Distance Matrix batching. Used by both radius discovery
and corridor discovery/itinerary optimization.
"""

from typing import Any

import googlemaps

from app.config import settings

# Google place types → our human-readable category labels
TYPE_MAP: dict[str, str] = {
    "park": "park",
    "natural_feature": "park",
    "campground": "park",
    "national_park": "park",
    "restaurant": "restaurant",
    "food": "restaurant",
    "cafe": "restaurant",
    "bar": "restaurant",
    "tourist_attraction": "landmark",
    "museum": "landmark",
    "art_gallery": "landmark",
    "amusement_park": "landmark",
    "stadium": "landmark",
    "church": "landmark",
    "place_of_worship": "landmark",
    "locality": "town",
    "sublocality": "town",
    "political": "town",
}

SEARCH_TYPES = [
    "tourist_attraction",
    "park",
    "campground",
    "museum",
    "restaurant",
    "art_gallery",
    "amusement_park",
]

# Distance Matrix: max 25 destinations per request
MATRIX_BATCH = 25


def get_client() -> googlemaps.Client:
    if not settings.maps_api_key:
        raise ValueError("MAPS_API_KEY is not configured")
    return googlemaps.Client(key=settings.maps_api_key)


def classify(place: dict[str, Any]) -> str:
    types: list[str] = place.get("types", [])
    for t in types:
        if t in TYPE_MAP:
            return TYPE_MAP[t]
    return "other"


def nearby_search(
    gmaps: googlemaps.Client,
    origin_lat: float,
    origin_lng: float,
    radius_meters: int,
    categories: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Run Nearby Search. Returns raw place dicts."""
    place_types = SEARCH_TYPES
    if categories:
        type_map_inv: dict[str, list[str]] = {}
        for gtype, cat in TYPE_MAP.items():
            type_map_inv.setdefault(cat, []).append(gtype)
        filtered = []
        for cat in categories:
            filtered.extend(type_map_inv.get(cat, []))
        place_types = filtered if filtered else SEARCH_TYPES

    seen_ids: set[str] = set()
    results: list[dict[str, Any]] = []

    for ptype in place_types[:5]:  # limit to first 5 types to stay under quota
        resp = gmaps.places_nearby(
            location={"lat": origin_lat, "lng": origin_lng},
            radius=min(radius_meters, 50000),
            type=ptype,
        )
        for place in resp.get("results", []):
            pid = place.get("place_id", "")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                results.append(place)
        if len(results) >= 100:
            break

    return results


def distance_matrix_filter(
    gmaps: googlemaps.Client,
    origin_lat: float,
    origin_lng: float,
    places: list[dict[str, Any]],
    max_drive_seconds: int,
) -> list[dict[str, Any]]:
    """Return places whose driving time from origin is ≤ max_drive_seconds, with timing data."""
    origin = f"{origin_lat},{origin_lng}"
    confirmed: list[dict[str, Any]] = []

    for i in range(0, len(places), MATRIX_BATCH):
        batch = places[i : i + MATRIX_BATCH]
        destinations = [
            f"{p['geometry']['location']['lat']},{p['geometry']['location']['lng']}"
            for p in batch
        ]
        try:
            matrix = gmaps.distance_matrix(
                origins=[origin],
                destinations=destinations,
                mode="driving",
            )
        except Exception:
            continue

        rows = matrix.get("rows", [])
        if not rows:
            continue
        elements = rows[0].get("elements", [])
        for place, elem in zip(batch, elements):
            if elem.get("status") != "OK":
                continue
            drive_secs = elem["duration"]["value"]
            dist_m = elem["distance"]["value"]
            if drive_secs <= max_drive_seconds:
                confirmed.append(
                    {
                        **place,
                        "_drive_seconds": drive_secs,
                        "_distance_meters": dist_m,
                    }
                )

    return confirmed


def detour_seconds_batch(
    gmaps: googlemaps.Client,
    origin: tuple[float, float],
    dest: tuple[float, float],
    candidates: list[dict[str, Any]],
    direct_drive_seconds: int,
    max_detour_seconds: int,
) -> list[dict[str, Any]]:
    """For each candidate place, compute detour_seconds = drive(origin->candidate)
    + drive(candidate->dest) - direct_drive_seconds. Returns candidates with
    _detour_seconds/_drive_seconds/_distance_meters attached, filtered to
    detour_seconds <= max_detour_seconds.
    """
    origin_str = f"{origin[0]},{origin[1]}"
    dest_str = f"{dest[0]},{dest[1]}"
    confirmed: list[dict[str, Any]] = []

    for i in range(0, len(candidates), MATRIX_BATCH):
        batch = candidates[i : i + MATRIX_BATCH]
        destinations = [
            f"{c['geometry']['location']['lat']},{c['geometry']['location']['lng']}"
            for c in batch
        ]
        try:
            leg1 = gmaps.distance_matrix(
                origins=[origin_str], destinations=destinations, mode="driving"
            )
            leg2 = gmaps.distance_matrix(
                origins=destinations, destinations=[dest_str], mode="driving"
            )
        except Exception:
            continue

        leg1_elements = leg1.get("rows", [{}])[0].get("elements", [])
        leg2_rows = leg2.get("rows", [])

        for idx, candidate in enumerate(batch):
            if idx >= len(leg1_elements) or idx >= len(leg2_rows):
                continue
            e1 = leg1_elements[idx]
            e2_elements = leg2_rows[idx].get("elements", [])
            if not e2_elements:
                continue
            e2 = e2_elements[0]
            if e1.get("status") != "OK" or e2.get("status") != "OK":
                continue

            leg1_seconds = e1["duration"]["value"]
            leg2_seconds = e2["duration"]["value"]
            detour = leg1_seconds + leg2_seconds - direct_drive_seconds
            if detour < 0:
                detour = 0
            if detour <= max_detour_seconds:
                confirmed.append(
                    {
                        **candidate,
                        "_detour_seconds": detour,
                        "_drive_seconds": leg1_seconds,
                        "_distance_meters": e1["distance"]["value"],
                    }
                )

    return confirmed


def distance_matrix_pairwise(
    gmaps: googlemaps.Client,
    points: list[tuple[float, float]],
) -> dict[tuple[int, int], int]:
    """Return a dense {(i, j): drive_seconds} matrix among all given points
    (indices into `points`). Batches destinations at MATRIX_BATCH per call,
    one call per origin point — fine for small N (<=20 points).
    """
    matrix: dict[tuple[int, int], int] = {}
    coords = [f"{lat},{lng}" for lat, lng in points]

    for i, origin in enumerate(coords):
        for j_start in range(0, len(coords), MATRIX_BATCH):
            batch_indices = list(range(j_start, min(j_start + MATRIX_BATCH, len(coords))))
            destinations = [coords[j] for j in batch_indices]
            try:
                resp = gmaps.distance_matrix(
                    origins=[origin], destinations=destinations, mode="driving"
                )
            except Exception:
                continue
            rows = resp.get("rows", [])
            if not rows:
                continue
            elements = rows[0].get("elements", [])
            for j, elem in zip(batch_indices, elements):
                if elem.get("status") != "OK":
                    continue
                matrix[(i, j)] = elem["duration"]["value"]

    return matrix
