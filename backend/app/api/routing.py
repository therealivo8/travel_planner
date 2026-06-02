import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import Trip, Waypoint
from app.schemas.trip import GeocodeResult, RouteOut, TripOut
from app.services import routes as route_svc

router = APIRouter(tags=["routing"])

DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_owned_trip(trip_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Trip:
    result = await db.execute(
        select(Trip)
        .where(Trip.id == trip_id, Trip.user_id == user_id)
        .options(selectinload(Trip.waypoints))
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


@router.post("/trips/{trip_id}/calculate-route", response_model=TripOut)
async def calculate_route(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = await _get_owned_trip(trip_id, current_user.id, db)

    if trip.mode != "point_to_point":
        raise HTTPException(status_code=400, detail="Route calculation is only for point_to_point trips")

    if trip.end_lat is None or trip.end_lng is None:
        raise HTTPException(status_code=400, detail="Trip has no end location set")

    ordered_waypoints = sorted(trip.waypoints, key=lambda w: w.position)
    waypoint_coords = [(float(w.lat), float(w.lng)) for w in ordered_waypoints]

    try:
        result = route_svc.calculate_route(
            origin_lat=float(trip.start_lat),
            origin_lng=float(trip.start_lng),
            dest_lat=float(trip.end_lat),
            dest_lng=float(trip.end_lng),
            waypoint_coords=waypoint_coords,
        )
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    trip.total_distance_meters = result["total_distance_meters"]
    trip.total_drive_seconds = result["total_drive_seconds"]
    trip.route_polyline = result["route_polyline"]
    trip.route_raw_response = result["raw_response"]

    # legs[0] is start→first-waypoint-or-destination
    # legs[i] corresponds to waypoint[i-1]→waypoint[i] (for middle legs)
    # The first waypoint's leg is legs[0], second is legs[1], etc.
    legs = result["legs"]
    for i, wp in enumerate(ordered_waypoints):
        # leg index: leg[0] = start→wp[0], leg[1] = wp[0]→wp[1], ...
        if i < len(legs):
            wp.drive_seconds_from_prev = legs[i]["drive_seconds"]
            wp.distance_meters_from_prev = legs[i]["distance_meters"]

    await db.commit()
    await db.refresh(trip)
    refreshed = await db.execute(
        select(Trip).where(Trip.id == trip.id).options(selectinload(Trip.waypoints))
    )
    return TripOut.model_validate(refreshed.scalar_one())


@router.get("/trips/{trip_id}/route", response_model=RouteOut)
async def get_route(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> RouteOut:
    trip = await _get_owned_trip(trip_id, current_user.id, db)

    if trip.route_polyline is None:
        raise HTTPException(status_code=404, detail="Route has not been calculated yet")

    ordered_waypoints = sorted(trip.waypoints, key=lambda w: w.position)

    # Build legs from stored waypoint data
    # leg[0] = start → wp[0], leg[1] = wp[0] → wp[1], ..., last leg = last_wp → end
    legs = []
    prev_id = None
    for wp in ordered_waypoints:
        legs.append(
            {
                "from_waypoint_id": prev_id,
                "to_waypoint_id": str(wp.id),
                "distance_meters": wp.distance_meters_from_prev,
                "drive_seconds": wp.drive_seconds_from_prev,
            }
        )
        prev_id = str(wp.id)

    return RouteOut(
        trip_id=trip.id,
        total_distance_meters=trip.total_distance_meters,
        total_drive_seconds=trip.total_drive_seconds,
        route_polyline=trip.route_polyline,
        legs=legs,
    )


@router.get("/geocode", response_model=GeocodeResult | None)
async def geocode(
    q: str = Query(..., description="Address to geocode"),
) -> GeocodeResult | None:
    """Proxy to Google Geocoding API — keeps the API key server-side."""
    try:
        result = route_svc.geocode_address(q)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        return None
    return GeocodeResult(**result)
