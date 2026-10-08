from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.core.trip_access import owned_by
from app.db.session import get_db
from app.models.trip import Trip
from app.schemas.memories import MapStats, MapStop, MapTrip, MyMapOut

router = APIRouter(tags=["map"])

DB = Annotated[AsyncSession, Depends(get_db)]


def trip_year(trip: Trip) -> int:
    d = trip.start_date
    return d.year if d else (trip.created_at or datetime.now()).year


@router.get("/map", response_model=MyMapOut)
async def my_map(
    current_user: CurrentUser, db: DB, year: int | None = Query(None, ge=1900, le=2200)
) -> MyMapOut:
    """Every trip's stored route and visited stops — all from the database, so the page costs
    one Dynamic Maps load and nothing else. The example trip isn't the user's travel."""
    trips = (
        (
            await db.execute(
                select(Trip)
                .where(
                    owned_by(current_user),
                    Trip.is_example.is_(False),
                    Trip.route_polyline.is_not(None),
                )
                .options(selectinload(Trip.waypoints))
                .order_by(Trip.start_date.desc().nulls_last(), Trip.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    years = sorted({trip_year(t) for t in trips}, reverse=True)
    shown = [t for t in trips if year is None or trip_year(t) == year]

    out: list[MapTrip] = []
    for t in shown:
        assert t.route_polyline is not None
        out.append(
            MapTrip(
                id=t.id,
                title=t.title,
                year=trip_year(t),
                route_polyline=t.route_polyline,
                total_distance_meters=t.total_distance_meters,
                stops_count=len(t.waypoints),
                visited_stops=[
                    MapStop(lat=float(w.lat), lng=float(w.lng), label=w.label)
                    for w in sorted(t.waypoints, key=lambda w: w.position)
                    if w.visited_at is not None
                ],
            )
        )
    longest = max(out, key=lambda t: t.total_distance_meters or 0, default=None)
    return MyMapOut(
        years=years,
        stats=MapStats(
            trips=len(out),
            total_distance_meters=sum(t.total_distance_meters or 0 for t in out),
            stops_visited=sum(len(t.visited_stops) for t in out),
            longest_trip_title=longest.title if longest and longest.total_distance_meters else None,
            longest_trip_distance_meters=longest.total_distance_meters if longest else None,
        ),
        trips=out,
    )
