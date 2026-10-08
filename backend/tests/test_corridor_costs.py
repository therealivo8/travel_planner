from app.core import cache
from app.services import corridor, places


def test_sample_count_scales_with_route_length() -> None:
    assert corridor.sample_count_for_route(20) == 3
    assert corridor.sample_count_for_route(120) == 3
    assert corridor.sample_count_for_route(150) == 3
    assert corridor.sample_count_for_route(300) == 5
    assert corridor.sample_count_for_route(2000) == 8


def test_default_corridor_types_are_the_curated_three() -> None:
    assert corridor.corridor_place_types(None) == ["tourist_attraction", "park", "restaurant"]


def test_selected_categories_replace_defaults_and_are_capped() -> None:
    assert corridor.corridor_place_types(["restaurant"]) == ["restaurant", "food", "cafe"]
    assert len(corridor.corridor_place_types(["landmark", "park"])) <= 3


def test_150km_route_makes_at_most_9_nearby_calls() -> None:
    nearby, matrix = corridor.estimate_units(150, None)
    assert nearby == 9
    assert matrix == 80


def test_worst_case_run_is_within_prd_caps() -> None:
    nearby, matrix = corridor.estimate_units(5000, None)
    assert nearby <= 24
    assert matrix <= 80


def test_distance_to_route_is_point_to_segment() -> None:
    route = [(40.0, -74.0), (40.0, -73.0)]  # runs due east, ~85 km
    # 0.01 degrees of latitude north of the midpoint is ~1.1 km off-route.
    d = corridor.distance_to_route_meters((40.01, -73.5), route)
    assert 1000 < d < 1200
    # Past the end of the segment, distance is to the endpoint, not the infinite line.
    far = corridor.distance_to_route_meters((40.0, -72.9), route)
    assert 8000 < far < 9000
    assert corridor.distance_to_route_meters((40.0, -73.5), route) < 1


def test_top_by_quality_keeps_best() -> None:
    items = [
        {"rating": 4.0, "user_ratings_total": 10},
        {"rating": 4.8, "user_ratings_total": 5000},
        {"rating": 4.5, "user_ratings_total": 300},
    ]
    kept = places.top_by_quality(items, 2)
    assert kept == [items[1], items[2]]


def test_cache_keys() -> None:
    assert cache.origin_key(40.7131, -74.0059) == "40.713,-74.006"
    a = cache.radius_cache_key(40.7131, -74.0059, 30, ["park", "restaurant"])
    b = cache.radius_cache_key(40.7129, -74.0061, 30, ["restaurant", "park"])
    assert a == b == "radius:40.713,-74.006:30:park,restaurant"
    assert cache.radius_cache_key(40.7131, -74.0059, 45, None) != a
    c1 = cache.corridor_cache_key("abc", 15, None)
    assert c1 == cache.corridor_cache_key("abc", 15, [])
    assert c1 != cache.corridor_cache_key("abd", 15, None)
    assert len(cache.radius_cache_key(1, 2, 3, ["x" * 300])) <= 128
