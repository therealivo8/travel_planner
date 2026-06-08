"""Radius mode discovery service.

Pipeline:
1. Fetch isochrone polygon from OpenRouteService.
2. Run Google Places Nearby Search within the bounding box.
3. Post-filter with Google Distance Matrix to confirm ≤ max_drive_minutes.
4. Return structured suggestions + raw isochrone GeoJSON.
"""

from typing import Any

import googlemaps
import httpx

from app.config import settings

# Google place types → our human-readable category labels
_TYPE_MAP: dict[str, str] = {
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

_SEARCH_TYPES = [
    "tourist_attraction",
    "park",
    "campground",
    "museum",
    "restaurant",
    "art_gallery",
    "amusement_park",
]

# Distance Matrix: max 25 destinations per request
_MATRIX_BATCH = 25


def _gmaps() -> googlemaps.Client:
    if not settings.maps_api_key:
        raise ValueError("MAPS_API_KEY is not configured")
    return googlemaps.Client(key=settings.maps_api_key)


def fetch_isochrone(
    origin_lat: float, origin_lng: float, max_drive_minutes: int
) -> dict[str, Any]:
    """Call ORS and return a GeoJSON Polygon dict."""
    if not settings.ors_api_key:
        raise ValueError("ORS_API_KEY is not configured")

    max_seconds = max_drive_minutes * 60
    url = "https://api.openrouteservice.org/v2/isochrones/driving-car"
    headers = {
        "Authorization": settings.ors_api_key,
        "Content-Type": "application/json",
    }
    body = {
        "locations": [[origin_lng, origin_lat]],
        "range": [max_seconds],
        "range_type": "time",
    }
    resp = httpx.post(url, json=body, headers=headers, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    # ORS returns a FeatureCollection; extract the first feature's geometry
    features = data.get("features", [])
    if not features:
        raise ValueError("ORS returned no isochrone features")

    geometry: dict[str, Any] = features[0]["geometry"]
    # ORS uses Polygon with coords [[lng,lat],...]; return as-is (GeoJSON)
    return geometry


def _bbox_from_polygon(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    """Return (min_lat, min_lng, max_lat, max_lng) from a GeoJSON Polygon."""
    coords = geometry["coordinates"][0]
    lngs = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lats), min(lngs), max(lats), max(lngs)


def _classify(place: dict[str, Any]) -> str:
    types: list[str] = place.get("types", [])
    for t in types:
        if t in _TYPE_MAP:
            return _TYPE_MAP[t]
    return "other"


def _nearby_search(
    gmaps: googlemaps.Client,
    origin_lat: float,
    origin_lng: float,
    radius_meters: int,
    categories: list[str] | None,
) -> list[dict[str, Any]]:
    """Run Nearby Search. Returns raw place dicts."""
    place_types = _SEARCH_TYPES
    if categories:
        type_map_inv: dict[str, list[str]] = {}
        for gtype, cat in _TYPE_MAP.items():
            type_map_inv.setdefault(cat, []).append(gtype)
        filtered = []
        for cat in categories:
            filtered.extend(type_map_inv.get(cat, []))
        place_types = filtered if filtered else _SEARCH_TYPES

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


def _distance_matrix_filter(
    gmaps: googlemaps.Client,
    origin_lat: float,
    origin_lng: float,
    places: list[dict[str, Any]],
    max_drive_seconds: int,
) -> list[dict[str, Any]]:
    """Return places whose driving time from origin is ≤ max_drive_seconds, with timing data."""
    origin = f"{origin_lat},{origin_lng}"
    confirmed: list[dict[str, Any]] = []

    for i in range(0, len(places), _MATRIX_BATCH):
        batch = places[i : i + _MATRIX_BATCH]
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


def discover_suggestions(
    origin_lat: float,
    origin_lng: float,
    max_drive_minutes: int,
    categories: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Full discovery pipeline. Returns {isochrone_geojson, suggestions}."""
    gmaps = _gmaps()

    # 1. Isochrone
    isochrone = fetch_isochrone(origin_lat, origin_lng, max_drive_minutes)

    # 2. Compute search radius from bbox diagonal (metres)
    import math

    min_lat, min_lng, max_lat, max_lng = _bbox_from_polygon(isochrone)
    lat_span = (max_lat - min_lat) * 111_000  # approx metres
    lng_span = (max_lng - min_lng) * 111_000 * math.cos(math.radians(origin_lat))
    search_radius = int(math.sqrt(lat_span**2 + lng_span**2) / 2)
    search_radius = max(5_000, min(search_radius, 50_000))

    # 3. Nearby search
    places = _nearby_search(gmaps, origin_lat, origin_lng, search_radius, categories)

    # 4. Distance Matrix filter
    max_drive_seconds = max_drive_minutes * 60
    confirmed = _distance_matrix_filter(gmaps, origin_lat, origin_lng, places, max_drive_seconds)

    # 5. Build suggestion dicts, sort by drive time, cap at limit
    confirmed.sort(key=lambda p: p["_drive_seconds"])
    suggestions = []
    for place in confirmed[:limit]:
        loc = place["geometry"]["location"]
        suggestions.append(
            {
                "place_id": place.get("place_id", ""),
                "name": place.get("name", ""),
                "address": place.get("vicinity") or place.get("formatted_address", ""),
                "lat": loc["lat"],
                "lng": loc["lng"],
                "category": _classify(place),
                "drive_seconds_from_start": place["_drive_seconds"],
                "distance_meters_from_start": place["_distance_meters"],
                "rating": place.get("rating"),
            }
        )

    return {
        "isochrone_geojson": isochrone,
        "suggestions": suggestions,
    }
