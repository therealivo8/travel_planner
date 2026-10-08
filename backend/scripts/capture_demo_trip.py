"""Re-capture app/fixtures/demo_trip.json from a real Google run.

Usage (needs MAPS_API_KEY; makes ~stops+2 Geocoding calls and 1 Directions call):

    uv run python -m scripts.capture_demo_trip "San Francisco, CA" "Los Angeles, CA" \
        "Half Moon Bay, CA" "Santa Cruz, CA" "Monterey, CA" ...

Writes only user-level data (addresses as typed, coordinates, drive times, polyline) — never
Google place names, ratings or place IDs — so the fixture stays within the caching terms.
Day assignments and arrival times are carried over from the existing fixture by stop index.
Run it only when the schema changes; the committed fixture is otherwise fine.
"""

import json
import sys

from app.core.demo import FIXTURE, load_fixture
from app.services import routes


def main(start: str, end: str, *stops: str) -> None:
    old = load_fixture()
    s, e = routes.geocode_address(start), routes.geocode_address(end)
    geocoded = [routes.geocode_address(q) for q in stops]
    if not s or not e or not all(geocoded):
        sys.exit("Could not geocode every address")
    route = routes.calculate_route(
        s["lat"], s["lng"], e["lat"], e["lng"], [(g["lat"], g["lng"]) for g in geocoded if g]
    )
    waypoints = []
    for i, (query, g, leg) in enumerate(zip(stops, geocoded, route["legs"], strict=False)):
        assert g
        prev = old["waypoints"][i] if i < len(old["waypoints"]) else {}
        waypoints.append(
            {
                "label": query.split(",")[0],
                "address": query,
                "lat": g["lat"],
                "lng": g["lng"],
                "drive_seconds_from_prev": leg["drive_seconds"],
                "distance_meters_from_prev": leg["distance_meters"],
                "stop_duration_minutes": prev.get("stop_duration_minutes", 60),
                "scheduled_arrival_time": prev.get("scheduled_arrival_time", "10:00"),
            }
        )
    old.update(
        start_address=start,
        start_lat=s["lat"],
        start_lng=s["lng"],
        end_address=end,
        end_lat=e["lat"],
        end_lng=e["lng"],
        total_distance_meters=route["total_distance_meters"],
        total_drive_seconds=route["total_drive_seconds"],
        route_polyline=route["route_polyline"],
        waypoints=waypoints,
    )
    old.pop("_note", None)
    FIXTURE.write_text(json.dumps(old, indent=2))
    print(f"Wrote {FIXTURE}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
