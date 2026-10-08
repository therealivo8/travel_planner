"""Navigation handoff links (Phase 16, Part D). Builds URLs only — no API is called and
nothing is billed: Google Maps URLs (`/maps/dir/?api=1`) and Apple Maps URLs are free
deep links that open the phone's maps app.

Google allows 9 intermediate waypoints per link in the app and on desktop; a longer day
is split into chunks, each starting where the previous one ended, so together the links
cover every stop in order. Mobile *browsers* are stricter (about 3) — check Google's Maps
URLs documentation before raising GOOGLE_MAX_WAYPOINTS.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode

from app.models.trip import Trip, Waypoint

GOOGLE_MAX_WAYPOINTS = 9
# One link = origin + up to 9 waypoints + a destination.
GOOGLE_STOPS_PER_LINK = GOOGLE_MAX_WAYPOINTS + 1


@dataclass(frozen=True)
class Point:
    lat: float
    lng: float
    place_id: str | None = None
    label: str | None = None

    @property
    def coords(self) -> str:
        return f"{self.lat:.6f},{self.lng:.6f}"


def point_from_waypoint(wp: Waypoint) -> Point:
    return Point(float(wp.lat), float(wp.lng), wp.place_id, wp.label or wp.address)


def day_stops(waypoints: Sequence[Waypoint]) -> list[Waypoint]:
    """A day's stops in the order the board shows them (same sort as the itinerary API)."""
    return sorted(waypoints, key=lambda w: (w.day_position is None, w.day_position, w.position))


def google_url(origin: Point, stops: Sequence[Point]) -> str:
    """One Google Maps directions URL: origin -> stops[:-1] as waypoints -> stops[-1]."""
    *middle, dest = stops
    params: dict[str, str] = {
        "api": "1",
        "origin": origin.coords,
        "destination": dest.coords,
        "travelmode": "driving",
    }
    if dest.place_id:
        params["destination_place_id"] = dest.place_id
    if middle:
        params["waypoints"] = "|".join(p.coords for p in middle)
        # Place IDs must line up one-to-one with waypoints, so only send them when every
        # waypoint has one; otherwise the coordinates alone still pin each stop.
        if all(p.place_id for p in middle):
            params["waypoint_place_ids"] = "|".join(p.place_id for p in middle if p.place_id)
    return "https://www.google.com/maps/dir/?" + urlencode(params, quote_via=quote, safe=",")


def google_links(origin: Point, stops: Sequence[Point]) -> list[dict[str, str]]:
    if not stops:
        return []
    chunks = [stops[i : i + GOOGLE_STOPS_PER_LINK] for i in range(0, len(stops), GOOGLE_STOPS_PER_LINK)]
    links = []
    start = origin
    for i, chunk in enumerate(chunks):
        label = (
            "Open in Google Maps" if len(chunks) == 1 else f"Part {i + 1} of {len(chunks)}"
        )
        links.append({"label": label, "url": google_url(start, chunk)})
        start = chunk[-1]
    return links


def apple_links(origin: Point, stops: Sequence[Point]) -> list[dict[str, str]]:
    """Apple Maps URLs can't carry multiple stops, so one link per leg."""
    links = []
    start = origin
    for stop in stops:
        query = urlencode(
            {"saddr": start.coords, "daddr": stop.coords, "dirflg": "d"}, safe=","
        )
        links.append({"label": stop.label or "Stop", "url": f"https://maps.apple.com/?{query}"})
        start = stop
    return links


def _links(origin: Point, stops: Sequence[Point]) -> dict[str, Any]:
    return {"google": google_links(origin, stops), "apple": apple_links(origin, stops)}


def build_navigation(trip: Trip) -> dict[str, Any]:
    """{"trip": links for the whole route, "days": {day_id: links}}.

    Each day starts from the previous day's last stop (or the trip start), so consecutive
    days chain together even when a day has no stops of its own.
    """
    start = Point(float(trip.start_lat), float(trip.start_lng), None, trip.start_address)
    trip_stops = [point_from_waypoint(w) for w in sorted(trip.waypoints, key=lambda w: w.position)]
    if trip.end_lat is not None and trip.end_lng is not None:
        trip_stops.append(
            Point(float(trip.end_lat), float(trip.end_lng), None, trip.end_address or "Destination")
        )

    days: dict[str, Any] = {}
    origin = start
    for day in sorted(trip.itinerary_days, key=lambda d: d.day_number):
        stops = [point_from_waypoint(w) for w in day_stops(day.waypoints)]
        days[str(day.id)] = _links(origin, stops)
        if stops:
            origin = stops[-1]
    return {"trip": _links(start, trip_stops), "days": days}
