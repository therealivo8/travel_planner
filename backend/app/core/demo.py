"""The example trip copied into every new account (Phase 15, Part C).

Loading it is database inserts only — no Google or ORS call — so a new user sees a complete
trip immediately without touching any API budget. The fixture holds user-level data only
(addresses, coordinates, times), not Google names, ratings or place IDs, which keeps it
within the caching terms from Phase 14.
"""

import json
from datetime import time
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import ItineraryDay, Trip, Waypoint

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "demo_trip.json"


def load_fixture() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(FIXTURE.read_text())
    return data


async def create_demo_trip(db: AsyncSession, user_id: Any) -> Trip:
    """Add the example trip to the session (flushed, not committed)."""
    f = load_fixture()
    trip = Trip(
        user_id=user_id,
        title=f["title"],
        mode=f["mode"],
        status="planned",
        start_address=f["start_address"],
        start_lat=f["start_lat"],
        start_lng=f["start_lng"],
        end_address=f["end_address"],
        end_lat=f["end_lat"],
        end_lng=f["end_lng"],
        notes=f["notes"],
        total_distance_meters=f["total_distance_meters"],
        total_drive_seconds=f["total_drive_seconds"],
        route_polyline=f["route_polyline"],
        is_example=True,
    )
    db.add(trip)
    await db.flush()

    waypoints: list[Waypoint] = []
    for i, w in enumerate(f["waypoints"]):
        hh, mm = w["scheduled_arrival_time"].split(":")
        waypoints.append(
            Waypoint(
                trip_id=trip.id,
                position=i,
                address=w["address"],
                lat=w["lat"],
                lng=w["lng"],
                label=w["label"],
                stop_duration_minutes=w["stop_duration_minutes"],
                drive_seconds_from_prev=w["drive_seconds_from_prev"],
                distance_meters_from_prev=w["distance_meters_from_prev"],
                scheduled_arrival_time=time(int(hh), int(mm)),
            )
        )
    db.add_all(waypoints)

    for n, d in enumerate(f["days"], start=1):
        day = ItineraryDay(trip_id=trip.id, day_number=n, title=d["title"], notes=d["notes"])
        db.add(day)
        await db.flush()
        for pos, idx in enumerate(d["waypoints"]):
            waypoints[idx].itinerary_day_id = day.id
            waypoints[idx].day_position = pos
    await db.flush()
    return trip
