import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import ItineraryDay, Trip
from app.schemas.trip import (
    ItineraryDayOut,
    ItineraryWaypointOut,
    PublicTripOut,
    ShareOut,
    WaypointOut,
)

router = APIRouter(tags=["sharing"])

DB = Annotated[AsyncSession, Depends(get_db)]


def _build_share_url(request: Request, token: str) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/shared/{token}"


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


@router.post("/trips/{trip_id}/share", response_model=ShareOut)
async def enable_sharing(
    trip_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser,
    db: DB,
) -> ShareOut:
    trip = await _get_owned_trip(trip_id, current_user.id, db)

    if not trip.share_token:
        trip.share_token = secrets.token_urlsafe(32)
    trip.is_public = True
    await db.commit()
    await db.refresh(trip)

    return ShareOut(
        share_token=trip.share_token,
        share_url=_build_share_url(request, trip.share_token),
        is_public=True,
    )


@router.delete("/trips/{trip_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def disable_sharing(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    trip = await _get_owned_trip(trip_id, current_user.id, db)
    trip.is_public = False
    trip.share_token = None
    await db.commit()


@router.get("/shared/{share_token}", response_model=PublicTripOut)
async def get_shared_trip(
    share_token: str,
    db: DB,
) -> PublicTripOut:
    result = await db.execute(
        select(Trip)
        .where(Trip.share_token == share_token, Trip.is_public.is_(True))
        .options(
            selectinload(Trip.waypoints),
            selectinload(Trip.itinerary_days).selectinload(ItineraryDay.waypoints),
        )
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared trip not found")

    sorted_wps = sorted(trip.waypoints, key=lambda w: w.position)
    sorted_days = sorted(trip.itinerary_days, key=lambda d: d.day_number)

    days_out = [
        ItineraryDayOut(
            id=d.id,
            trip_id=d.trip_id,
            day_number=d.day_number,
            date=d.date,
            title=d.title,
            notes=d.notes,
            waypoints=[
                ItineraryWaypointOut(
                    id=w.id,
                    label=w.label,
                    address=w.address,
                    position=w.position,
                    scheduled_arrival_time=w.scheduled_arrival_time,
                    drive_seconds_from_prev=w.drive_seconds_from_prev,
                )
                for w in sorted(d.waypoints, key=lambda w: w.position)
            ],
        )
        for d in sorted_days
    ]

    return PublicTripOut(
        id=trip.id,
        title=trip.title,
        mode=trip.mode,
        start_address=trip.start_address,
        start_lat=float(trip.start_lat),
        start_lng=float(trip.start_lng),
        end_address=trip.end_address,
        end_lat=float(trip.end_lat) if trip.end_lat is not None else None,
        end_lng=float(trip.end_lng) if trip.end_lng is not None else None,
        total_distance_meters=trip.total_distance_meters,
        total_drive_seconds=trip.total_drive_seconds,
        route_polyline=trip.route_polyline,
        start_date=trip.start_date,
        cover_image_url=trip.cover_image_url,
        waypoints=[WaypointOut.model_validate(w) for w in sorted_wps],
        days=days_out,
    )
