"""Radius-mode single-day itinerary builder: orders selected suggestions to minimize
backtracking and validates the round trip against the trip's time budget.

Algorithm: nearest-neighbor construction + 2-opt local search — a small-N TSP heuristic.
Appropriate because selected suggestion counts are realistically <= 15-20 (radius
discovery caps at limit=50 total, and users select a subset of those).
"""

from typing import Any

from app.services import places

TWO_OPT_MAX_ITERATIONS = 200


def _route_total_seconds(
    order: list[int], matrix: dict[tuple[int, int], int], origin_index: int
) -> int:
    """Round trip: origin -> order[0] -> ... -> order[-1] -> origin."""
    if not order:
        return 0
    total = matrix.get((origin_index, order[0]), 0)
    for i in range(len(order) - 1):
        total += matrix.get((order[i], order[i + 1]), 0)
    total += matrix.get((order[-1], origin_index), 0)
    return total


def _nearest_neighbor_order(
    matrix: dict[tuple[int, int], int], origin_index: int, stop_indices: list[int]
) -> list[int]:
    remaining = set(stop_indices)
    order: list[int] = []
    current = origin_index
    while remaining:
        nxt = min(remaining, key=lambda i: matrix.get((current, i), float("inf")))
        order.append(nxt)
        remaining.discard(nxt)
        current = nxt
    return order


def _two_opt(
    order: list[int], matrix: dict[tuple[int, int], int], origin_index: int
) -> list[int]:
    if len(order) < 3:
        return order

    best = order[:]
    best_total = _route_total_seconds(best, matrix, origin_index)
    improved = True
    iterations = 0

    while improved and iterations < TWO_OPT_MAX_ITERATIONS:
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + best[i : j + 1][::-1] + best[j + 1 :]
                candidate_total = _route_total_seconds(candidate, matrix, origin_index)
                iterations += 1
                if candidate_total < best_total:
                    best = candidate
                    best_total = candidate_total
                    improved = True
                if iterations >= TWO_OPT_MAX_ITERATIONS:
                    return best

    return best


def _drop_worst_marginal_stop(
    order: list[int], matrix: dict[tuple[int, int], int], origin_index: int
) -> tuple[list[int], int]:
    """Return (order_without_worst_stop, dropped_index) — the stop whose removal
    reduces total round-trip time the most.
    """
    current_total = _route_total_seconds(order, matrix, origin_index)
    best_reduction = -1.0
    worst_index = order[0]
    best_order = order[1:]

    for i, stop in enumerate(order):
        without = order[:i] + order[i + 1 :]
        total = _route_total_seconds(without, matrix, origin_index)
        reduction = current_total - total
        if reduction > best_reduction:
            best_reduction = reduction
            worst_index = stop
            best_order = without

    return best_order, worst_index


def build_ordered_itinerary(
    origin: tuple[float, float],
    stops: list[dict[str, Any]],
    budget_minutes: int,
) -> dict[str, Any]:
    """stops: [{id, lat, lng, stop_duration_minutes}, ...]

    Returns {ordered_stop_ids, total_drive_seconds, total_stop_minutes, dropped_stop_ids,
    cheapest_single_stop_minutes}. cheapest_single_stop_minutes is the round-trip + stop-time
    cost of the single cheapest stop alone — useful for reporting "over budget" meaningfully
    when every stop had to be dropped to fit.
    """
    if not stops:
        return {
            "ordered_stop_ids": [],
            "total_drive_seconds": 0,
            "total_stop_minutes": 0,
            "dropped_stop_ids": [],
            "cheapest_single_stop_minutes": 0,
        }

    gmaps = places.get_client()
    points = [origin] + [(s["lat"], s["lng"]) for s in stops]
    origin_index = 0
    stop_indices = list(range(1, len(points)))
    index_to_id = {i + 1: s["id"] for i, s in enumerate(stops)}
    stop_duration_by_index = {i + 1: s["stop_duration_minutes"] for i, s in enumerate(stops)}

    matrix = places.distance_matrix_pairwise(gmaps, points)

    cheapest_single_stop_minutes = min(
        _route_total_seconds([i], matrix, origin_index) // 60 + stop_duration_by_index[i]
        for i in stop_indices
    )

    order = _nearest_neighbor_order(matrix, origin_index, stop_indices)
    order = _two_opt(order, matrix, origin_index)

    budget_seconds = budget_minutes * 60
    dropped: list[int] = []

    while order:
        total_drive = _route_total_seconds(order, matrix, origin_index)
        total_stop_minutes = sum(stop_duration_by_index[i] for i in order)
        total_seconds = total_drive + total_stop_minutes * 60
        if total_seconds <= budget_seconds:
            break
        order, dropped_index = _drop_worst_marginal_stop(order, matrix, origin_index)
        dropped.append(dropped_index)
        order = _two_opt(order, matrix, origin_index)

    total_drive_seconds = _route_total_seconds(order, matrix, origin_index)
    total_stop_minutes = sum(stop_duration_by_index[i] for i in order)

    return {
        "ordered_stop_ids": [index_to_id[i] for i in order],
        "total_drive_seconds": total_drive_seconds,
        "total_stop_minutes": total_stop_minutes,
        "dropped_stop_ids": [index_to_id[i] for i in dropped],
        "cheapest_single_stop_minutes": cheapest_single_stop_minutes,
    }
