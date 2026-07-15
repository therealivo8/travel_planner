"""Shared Google Maps Platform helpers: client construction, Places Nearby Search,
place classification, Distance Matrix batching, and quality scoring. Used by both
radius discovery and corridor discovery/itinerary optimization.
"""

import math
import time
from concurrent.futures import ThreadPoolExecutor
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

# Nearby Search pagination: Google returns up to 20 results per page, up to 3
# pages (60 results) per query via next_page_token. Without this, ranking only
# ever sees the first ~20 "prominent" results per place type — often a mix of
# genuinely excellent and merely-average places — so a well-reviewed spot that
# didn't make Google's default top-20 for that type/location is invisible to
# quality_score entirely, no matter how good its rating is.
#
# Only opted into by radius discovery (one search per category — a couple of
# extra paginated calls is cheap). Corridor discovery searches from up to 8
# points along the route per call; paginating there too would mean up to
# 8 samples x 5 types x 2 extra pages x the delay below, easily exceeding a
# reasonable request timeout. Corridor gets its pool depth from sampling many
# locations instead of paging deeply at each one.
MAX_PAGES_PER_TYPE = 2
# Google requires a short delay before a next_page_token becomes valid; polling
# immediately returns INVALID_REQUEST. 2s is Google's documented minimum.
NEXT_PAGE_DELAY_SECONDS = 2.0

# Quality floor applied before ranking (not just sorted to the bottom): Nearby
# Search's "prominence" ranking includes chains, gas stations, and other
# low-signal places alongside genuine highlights. Filtering these out before
# quality_score runs means the ranked list is built entirely from candidates
# that already clear a basic bar, rather than technically including everything
# and hoping the sort buries the noise far enough down.
MIN_RATING = 4.0
MIN_USER_RATINGS_TOTAL = 10


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


def quality_score(place: dict[str, Any]) -> float:
    """Composite "how impressive/popular is this place" score.

    Raw star rating alone is misleading at low review counts (a 5.0 average from
    3 reviews is noise, not a signal), so this multiplies rating by log10 of the
    review count. The log (rather than the raw count) keeps a handful of very
    high-volume tourist landmarks from completely swamping smaller but still
    well-regarded places — going from 10 reviews to 100 matters more than going
    from 10,000 to 100,000. Places with no rating data score 0 so they sort last
    within their time bucket, but they aren't excluded outright.

    score = rating * log10(user_ratings_total + 1)   (+1 avoids log10(0))
    """
    rating = place.get("rating")
    review_count = place.get("user_ratings_total")
    if rating is None or not review_count:
        return 0.0
    return float(rating) * math.log10(float(review_count) + 1)


TIME_BUCKET_SECONDS = 5 * 60  # 5-minute tiers


def rank_by_time_bucket_then_quality(
    places_list: list[dict[str, Any]], time_key: str
) -> list[dict[str, Any]]:
    """Sort places into coarse time buckets (by `place[time_key]`, in seconds),
    then rank by quality_score descending within each bucket.

    Sorting by raw time first (as this code did before) makes quality_score a
    no-op in practice: real-world drive/detour times are almost never exactly
    equal, so "sort by time, then quality as a tiebreak" never actually reaches
    the tiebreak. Bucketing into 5-minute tiers first means quality_score decides
    the order *within* "roughly N minutes away" — e.g. a highly-rated museum can
    outrank a forgettable strip mall that happens to be a minute or two closer,
    while a place across town still won't outrank one nearby just for being
    better reviewed. Sort key is (bucket ascending, quality_score descending).
    """
    return sorted(
        places_list,
        key=lambda p: (p[time_key] // TIME_BUCKET_SECONDS, -quality_score(p)),
    )


def _nearby_search_one_type(
    gmaps: googlemaps.Client,
    origin_lat: float,
    origin_lng: float,
    radius_meters: int,
    ptype: str,
    paginate: bool,
) -> list[dict[str, Any]]:
    """Fetch results for a single place type. If `paginate`, follows up to
    MAX_PAGES_PER_TYPE pages (~40-60 results); otherwise returns just page 1
    (~20 results).
    """
    results: list[dict[str, Any]] = []
    page_token: str | None = None
    max_pages = MAX_PAGES_PER_TYPE if paginate else 1

    for _ in range(max_pages):
        kwargs: dict[str, Any] = {
            "location": {"lat": origin_lat, "lng": origin_lng},
            "radius": min(radius_meters, 50000),
            "type": ptype,
            "rank_by": "prominence",  # lets radius take effect; ranks by prominence + rating
        }
        if page_token:
            # location/radius/type are ignored by the API when page_token is set,
            # but the client library still requires them to be passed.
            kwargs["page_token"] = page_token
            # Google rejects a page_token used before ~2s of server-side propagation.
            time.sleep(NEXT_PAGE_DELAY_SECONDS)

        resp = gmaps.places_nearby(**kwargs)
        results.extend(resp.get("results", []))

        page_token = resp.get("next_page_token")
        if not page_token:
            break

    return results


def nearby_search(
    gmaps: googlemaps.Client,
    origin_lat: float,
    origin_lng: float,
    radius_meters: int,
    categories: list[str] | None = None,
    paginate: bool = False,
) -> list[dict[str, Any]]:
    """Run Nearby Search across up to 5 place types.

    `paginate=True` follows Google's next_page_token up to MAX_PAGES_PER_TYPE
    pages per type, giving a deeper pool for quality-based ranking to work with
    (a single page is only Google's top ~20 "prominent" results, which is often
    too shallow to contain every place that would score well on quality_score).
    Each extra page costs a ~2s mandatory delay, so this defaults to off and
    should only be enabled by callers that search from a single origin (radius
    mode). Callers that search from many origins per request (corridor mode,
    sampling multiple points along a route) should leave this off and rely on
    breadth-of-origins instead of per-origin depth to keep latency reasonable.

    Returns deduplicated raw place dicts; does not filter by rating — callers
    that want a quality floor should use filter_by_quality() afterward.
    """
    place_types = SEARCH_TYPES
    if categories:
        type_map_inv: dict[str, list[str]] = {}
        for gtype, cat in TYPE_MAP.items():
            type_map_inv.setdefault(cat, []).append(gtype)
        filtered = []
        for cat in categories:
            filtered.extend(type_map_inv.get(cat, []))
        place_types = filtered if filtered else SEARCH_TYPES

    types_to_query = place_types[:5]  # limit to first 5 types to stay under quota

    # Query each place type concurrently rather than sequentially. This matters
    # most when paginate=True: each extra page requires a ~2s mandatory Google
    # delay, and if 5 types were queried one after another that delay stacks up
    # to ~10s of pure wait time. Running the (independent, per-type) searches in
    # a thread pool means those delays overlap instead, so total latency is
    # roughly one type's worth of pagination delay, not five.
    with ThreadPoolExecutor(max_workers=len(types_to_query)) as pool:
        per_type_results = list(
            pool.map(
                lambda ptype: _nearby_search_one_type(
                    gmaps, origin_lat, origin_lng, radius_meters, ptype, paginate
                ),
                types_to_query,
            )
        )

    seen_ids: set[str] = set()
    results: list[dict[str, Any]] = []
    for found in per_type_results:
        for place in found:
            pid = place.get("place_id", "")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                results.append(place)
        if len(results) >= 250:  # hard cap across all types/pages
            break

    return results


def filter_by_quality(
    places_list: list[dict[str, Any]],
    min_rating: float = MIN_RATING,
    min_reviews: int = MIN_USER_RATINGS_TOTAL,
) -> list[dict[str, Any]]:
    """Drop candidates below a minimum rating/review-count bar. Places with no
    rating data at all are kept (there's no signal to reject them on, and some
    genuinely good but newly-added places haven't accumulated reviews yet) —
    this only removes places that have a *confirmed* mediocre or thin record.
    """
    kept = []
    for place in places_list:
        rating = place.get("rating")
        review_count = place.get("user_ratings_total")
        if rating is None and review_count is None:
            kept.append(place)
            continue
        if (rating or 0) >= min_rating and (review_count or 0) >= min_reviews:
            kept.append(place)
    return kept


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
