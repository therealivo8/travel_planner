import polyline as polyline_codec


def simplify_polyline(encoded: str | None, max_points: int = 80) -> str | None:
    """Re-encode a route with at most `max_points` points (always keeping the ends).

    A full Directions polyline can be tens of KB; a card thumbnail needs only its shape.
    """
    if not encoded:
        return None
    points = polyline_codec.decode(encoded)
    if len(points) > max_points:
        step = (len(points) - 1) / (max_points - 1)
        points = [points[round(i * step)] for i in range(max_points)]
    return str(polyline_codec.encode(points))
