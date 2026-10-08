import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.core.limiter import limiter
from app.core.trips import get_owned_trip
from app.db.session import get_db
from app.models.trip import ItineraryDay, Trip
from app.schemas.logistics import NavigationOut
from app.services.navigation import build_navigation

router = APIRouter(tags=["navigation"])

DB = Annotated[AsyncSession, Depends(get_db)]

_LOAD = (
    selectinload(Trip.waypoints),
    selectinload(Trip.itinerary_days).selectinload(ItineraryDay.waypoints),
)


@router.get("/trips/{trip_id}/navigation", response_model=NavigationOut)
async def trip_navigation(
    trip_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> dict[str, Any]:
    return build_navigation(await get_owned_trip(db, trip_id, current_user.id, *_LOAD))


@router.get("/shared/{share_token}/navigation", response_model=NavigationOut)
@limiter.limit("60/hour")
async def shared_navigation(request: Request, share_token: str, db: DB) -> dict[str, Any]:
    trip = (
        await db.execute(
            select(Trip)
            .where(Trip.share_token == share_token, Trip.is_public.is_(True))
            .options(*_LOAD)
        )
    ).scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared trip not found")
    return build_navigation(trip)
