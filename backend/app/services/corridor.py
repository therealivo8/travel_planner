"""Corridor stop discovery for point-to-point trips.

Pipeline:
1. Decode the trip's route_polyline into a list of (lat, lng) points.
2. Sample N evenly-spaced points along the polyline (by cumulative distance, not index);
   N scales with route length (3-8).
3. Run Nearby Search (≤3 types) around each sample point, dedup across samples by place_id.
3b. Drop candidates too far from the route in a straight line and keep the top 40 by
   quality_score — both free, and they cap Distance Matrix at 80 elements.
4. For each candidate, compute detour_seconds = drive(start->candidate) + drive(candidate->end)
   - direct_drive_seconds via Google Distance Matrix.
5. Filter to candidates within max_detour_minutes. Attach route_fraction (0.0-1.0 position
   along the route where the candidate was found, for ordering/interleaving with waypoints).
6. Rank into 5-minute detour buckets, then by quality_score (rating x review volume)
   descending within each bucket — see app/services/places.py:rank_by_time_bucket_then_quality.
   Cap at limit.

This function takes plain geometry/numeric inputs and returns plain dicts — no FastAPI/DB
coupling — so a future LLM-based suggestion feature can call it directly to get a
geometrically-valid candidate pool before re-ranking by natural-language preference.
"""

import math
from typing import Any

import polyline as polyline_codec

from app.services import places

DEFAULT_MAX_DETOUR_MINUTES = 15
SEARCH_RADIUS_METERS = 8_000

# Phase 14 cost controls (see docs/prd/phase-14-api-budget-and-caching.md, Part D).
KM_PER_SAMPLE = 60
MIN_SAMPLES = 3
MAX_SAMPLES = 8
# Curated fallback when the user picked no categories (vs. 5 types in radius mode).
CORRIDOR_DEFAULT_TYPES = ["tourist_attraction", "park", "restaurant"]
MAX_TYPES_PER_SAMPLE = 3
# Distance Matrix costs 2 elements per candidate, so this caps a run at 80 elements.
MAX_DETOUR_CANDIDATES = 40
# Generous straight-line upper bound on road speed: 90 km/h = 1.5 km per minute.
STRAIGHT_LINE_KM_PER_MINUTE = 1.5


def sample_count_for_route(route_km: float) -> int:
    """Samples scale with route length: a 120 km trip needs 3, not 8."""
    return max(MIN_SAMPLES, min(MAX_SAMPLES, round(route_km / KM_PER_SAMPLE)))


def corridor_place_types(categories: list[str] | None) -> list[str]:
    return places.resolve_place_types(categories, CORRIDOR_DEFAULT_TYPES, MAX_TYPES_PER_SAMPLE)


def estimate_units(
    route_km: float, categories: list[str] | None
) -> tuple[int, int]:
    """(Nearby Search calls, Distance Matrix elements) a run can use, for budgeting."""
    nearby = sample_count_for_route(route_km) * len(corridor_place_types(categories))
    return nearby, 2 * MAX_DETOUR_CANDIDATES


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


def _distance_to_segment_meters(
    p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float:
    """Distance from p to segment a-b, using a local equirectangular projection (accurate
    to well under 1% over the few-km scales that matter for a corridor filter)."""
    lat0 = math.radians(p[0])
    kx = 111_320 * math.cos(lat0)
    ky = 110_540

    def xy(q: tuple[float, float]) -> tuple[float, float]:
        return (q[1] - p[1]) * kx, (q[0] - p[0]) * ky

    ax, ay = xy(a)
    bx, by = xy(b)
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / seg_len_sq))
    return math.hypot(ax + t * dx, ay + t * dy)


def distance_to_route_meters(
    p: tuple[float, float], route_points: list[tuple[float, float]]
) -> float:
    if len(route_points) == 1:
        return _haversine_meters(p, route_points[0])
    return min(
        _distance_to_segment_meters(p, route_points[i], route_points[i + 1])
        for i in range(len(route_points) - 1)
    )


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
    sample_count: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Full corridor discovery pipeline. Returns a list of suggestion dicts matching
    CorridorSuggestionOut fields (minus id/trip_id/created_at).
    """
    gmaps = places.get_client()
    points = decode_polyline_points(route_polyline)
    if sample_count is None:
        route_km = sum(_haversine_meters(points[i - 1], points[i]) for i in range(1, len(points)))
        sample_count = sample_count_for_route(route_km / 1000)
    samples = _sample_points(points, sample_count)
    place_types = corridor_place_types(categories)

    seen_place_ids: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for (lat, lng), fraction in samples:
        found = places.nearby_search(
            gmaps, lat, lng, SEARCH_RADIUS_METERS, categories, place_types=place_types
        )
        # Drop low-rating/low-review noise before spending Distance Matrix calls
        # confirming detour times for places we'd exclude anyway.
        found = places.filter_by_quality(found)
        for place in found:
            pid = place.get("place_id", "")
            if not pid or pid in seen_place_ids:
                continue
            seen_place_ids.add(pid)
            candidates.append({**place, "_route_fraction": fraction})

    # Free local pre-filter: a detour goes out and back, so a stop can be at most half the
    # detour time off the route; drop everything farther than that (at a generous
    # straight-line speed) before paying for Distance Matrix.
    max_offroute_m = (max_detour_minutes / 2) * STRAIGHT_LINE_KM_PER_MINUTE * 1000
    candidates = [
        c
        for c in candidates
        if distance_to_route_meters(
            (c["geometry"]["location"]["lat"], c["geometry"]["location"]["lng"]), points
        )
        <= max_offroute_m
    ]
    candidates = places.top_by_quality(candidates, MAX_DETOUR_CANDIDATES)

    max_detour_seconds = max_detour_minutes * 60
    confirmed = places.detour_seconds_batch(
        gmaps,
        (origin_lat, origin_lng),
        (dest_lat, dest_lng),
        candidates,
        direct_drive_seconds,
        max_detour_seconds,
    )
    ranked = places.rank_by_time_bucket_then_quality(confirmed, "_detour_seconds")

    suggestions = []
    for place in ranked[:limit]:
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
                "user_ratings_total": place.get("user_ratings_total"),
                "quality_score": places.quality_score(place),
                "detour_seconds": place["_detour_seconds"],
                "route_fraction": place["_route_fraction"],
            }
        )

    return suggestions
