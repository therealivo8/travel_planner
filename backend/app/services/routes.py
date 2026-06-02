"""Route calculation service — wraps the Google Routes API (v2) via the googlemaps SDK."""

from typing import Any

import googlemaps

from app.config import settings


def _client() -> googlemaps.Client:
    if not settings.maps_api_key:
        raise ValueError("MAPS_API_KEY is not configured")
    return googlemaps.Client(key=settings.maps_api_key)


def calculate_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    waypoint_coords: list[tuple[float, float]],
) -> dict[str, Any]:
    """Call Google Directions API and return structured route data.

    Returns a dict with keys:
        total_distance_meters, total_drive_seconds, route_polyline,
        legs (list of {distance_meters, drive_seconds}), raw_response
    """
    gmaps = _client()

    origin = {"lat": origin_lat, "lng": origin_lng}
    destination = {"lat": dest_lat, "lng": dest_lng}
    waypoints = [{"lat": lat, "lng": lng} for lat, lng in waypoint_coords]

    raw: list[Any] = gmaps.directions(
        origin=origin,
        destination=destination,
        waypoints=waypoints if waypoints else None,
        mode="driving",
        optimize_waypoints=False,
    )

    if not raw:
        raise ValueError("Google Directions API returned no routes")

    route = raw[0]
    legs = route["legs"]

    total_distance = sum(leg["distance"]["value"] for leg in legs)
    total_duration = sum(leg["duration"]["value"] for leg in legs)
    polyline = route["overview_polyline"]["points"]

    parsed_legs = [
        {
            "distance_meters": leg["distance"]["value"],
            "drive_seconds": leg["duration"]["value"],
        }
        for leg in legs
    ]

    return {
        "total_distance_meters": total_distance,
        "total_drive_seconds": total_duration,
        "route_polyline": polyline,
        "legs": parsed_legs,
        "raw_response": raw,
    }


def geocode_address(address: str) -> dict[str, Any] | None:
    """Geocode an address. Returns {address, lat, lng} or None."""
    gmaps = _client()
    results = gmaps.geocode(address)
    if not results:
        return None
    r = results[0]
    loc = r["geometry"]["location"]
    return {
        "address": r["formatted_address"],
        "lat": loc["lat"],
        "lng": loc["lng"],
        "place_id": r.get("place_id"),
    }
