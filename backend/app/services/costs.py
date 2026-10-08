"""Trip cost estimates from data the app already stores (Phase 16, Part A)."""

METERS_PER_MILE = 1609.34


def fuel_estimate(distance_meters: int | float | None, mpg: float, price: float) -> float:
    """Fuel cost for a distance: miles / mpg * price per gallon, rounded to cents."""
    if not distance_meters or mpg <= 0:
        return 0.0
    return round(distance_meters / METERS_PER_MILE / mpg * price, 2)
