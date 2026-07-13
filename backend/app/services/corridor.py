"""Corridor stop discovery for point-to-point trips.

Pipeline:
1. Decode the trip's route_polyline into a list of (lat, lng) points.
2. Sample N evenly-spaced points along the polyline (by cumulative distance, not index).
3. Run Nearby Search around each sample point, dedup across samples by place_id.
4. For each candidate, compute detour_seconds = drive(start->candidate) + drive(candidate->end)
   - direct_drive_seconds via Google Distance Matrix.
5. Filter to candidates within max_detour_minutes. Attach route_fraction (0.0-1.0 position
   along the route where the candidate was found, for ordering/interleaving with waypoints).
6. Sort by detour_seconds ascending, cap at limit.

This function takes plain geometry/numeric inputs and returns plain dicts — no FastAPI/DB
coupling — so a future LLM-based suggestion feature can call it directly to get a
geometrically-valid candidate pool before re-ranking by natural-language preference.
"""

import math
from typing import Any

import polyline as polyline_codec

from app.services import places

DEFAULT_SAMPLE_COUNT = 8
DEFAULT_MAX_DETOUR_MINUTES = 15
SEARCH_RADIUS_METERS = 8_000


def decode_polyline_points(encoded: str) -> list[tuple[float, float]]:
    """Decode a Google-encoded polyline string into a list of (lat, lng) points."""
    return polyline_codec.decode(encoded)


def _haversine_meters(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _sample_points(
    points: list[tuple[float, float]], n: int
) -> list[tuple[tuple[float, float], float]]:
    """Return up to n points evenly spaced by cumulative distance along `points`,
    each paired with its route_fraction (0.0-1.0).
    """
    if not points:
        return []
    if len(points) == 1:
        return [(points[0], 0.0)]

    cumulative = [0.0]
    for i in range(1, len(points)):
        cumulative.append(cumulative[-1] + _haversine_meters(points[i - 1], points[i]))
    total = cumulative[-1]
    if total == 0:
        return [(points[0], 0.0)]

    samples: list[tuple[tuple[float, float], float]] = []
    for k in range(n):
        target_fraction = k / (n - 1) if n > 1 else 0.0
        target_dist = target_fraction * total
        # find the first cumulative distance >= target_dist
        idx = 0
        while idx < len(cumulative) - 1 and cumulative[idx] < target_dist:
            idx += 1
        samples.append((points[idx], target_fraction))

    return samples


def discover_corridor_suggestions(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    route_polyline: str,
    direct_drive_seconds: int,
    max_detour_minutes: int = DEFAULT_MAX_DETOUR_MINUTES,
    categories: list[str] | None = None,
    sample_count: int = DEFAULT_SAMPLE_COUNT,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Full corridor discovery pipeline. Returns a list of suggestion dicts matching
    CorridorSuggestionOut fields (minus id/trip_id/created_at).
    """
    gmaps = places.get_client()
    points = decode_polyline_points(route_polyline)
    samples = _sample_points(points, sample_count)

    seen_place_ids: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for (lat, lng), fraction in samples:
        found = places.nearby_search(gmaps, lat, lng, SEARCH_RADIUS_METERS, categories)
        for place in found:
            pid = place.get("place_id", "")
            if not pid or pid in seen_place_ids:
                continue
            seen_place_ids.add(pid)
            candidates.append({**place, "_route_fraction": fraction})

    max_detour_seconds = max_detour_minutes * 60
    confirmed = places.detour_seconds_batch(
        gmaps,
        (origin_lat, origin_lng),
        (dest_lat, dest_lng),
        candidates,
        direct_drive_seconds,
        max_detour_seconds,
    )
    confirmed.sort(key=lambda c: c["_detour_seconds"])

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
                "rating": place.get("rating"),
                "detour_seconds": place["_detour_seconds"],
                "route_fraction": place["_route_fraction"],
            }
        )

    return suggestions
