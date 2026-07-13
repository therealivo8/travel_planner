"""Radius mode discovery service.

Pipeline:
1. Fetch isochrone polygon from OpenRouteService.
2. Run Google Places Nearby Search within the bounding box.
3. Post-filter with Google Distance Matrix to confirm ≤ max_drive_minutes.
4. Return structured suggestions + raw isochrone GeoJSON.
"""

import math
from typing import Any

import httpx

from app.config import settings
from app.services import places


def fetch_isochrone(
    origin_lat: float, origin_lng: float, max_drive_minutes: int
) -> dict[str, Any]:
    """Call ORS and return a GeoJSON Polygon dict."""
    if not settings.ors_api_key:
        raise ValueError("ORS_API_KEY is not configured")

    max_seconds = min(max_drive_minutes * 60, 3600)  # ORS free tier caps at 3600s
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
    resp = httpx.post(url, json=body, headers=headers, timeout=30)
    if not resp.is_success:
        raise ValueError(f"ORS error {resp.status_code}: {resp.text}")
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


def discover_suggestions(
    origin_lat: float,
    origin_lng: float,
    max_drive_minutes: int,
    categories: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Full discovery pipeline. Returns {isochrone_geojson, suggestions}."""
    gmaps = places.get_client()

    # 1. Isochrone
    isochrone = fetch_isochrone(origin_lat, origin_lng, max_drive_minutes)

    # 2. Compute search radius from bbox diagonal (metres)
    min_lat, min_lng, max_lat, max_lng = _bbox_from_polygon(isochrone)
    lat_span = (max_lat - min_lat) * 111_000  # approx metres
    lng_span = (max_lng - min_lng) * 111_000 * math.cos(math.radians(origin_lat))
    search_radius = int(math.sqrt(lat_span**2 + lng_span**2) / 2)
    search_radius = max(5_000, min(search_radius, 50_000))

    # 3. Nearby search
    found = places.nearby_search(gmaps, origin_lat, origin_lng, search_radius, categories)

    # 4. Distance Matrix filter
    max_drive_seconds = max_drive_minutes * 60
    confirmed = places.distance_matrix_filter(
        gmaps, origin_lat, origin_lng, found, max_drive_seconds
    )

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
                "category": places.classify(place),
                "drive_seconds_from_start": place["_drive_seconds"],
                "distance_meters_from_start": place["_distance_meters"],
                "rating": place.get("rating"),
            }
        )

    return {
        "isochrone_geojson": isochrone,
        "suggestions": suggestions,
    }
