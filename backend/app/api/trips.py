import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import Trip
from app.schemas.trip import (
    PaginatedTrips,
    TripCreate,
    TripListOut,
    TripOut,
    TripUpdate,
)

router = APIRouter(prefix="/trips", tags=["trips"])

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


@router.get("", response_model=PaginatedTrips)
async def list_trips(
    current_user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> PaginatedTrips:
    offset = (page - 1) * page_size
    total_result = await db.execute(
        select(func.count()).select_from(Trip).where(Trip.user_id == current_user.id)
    )
    total = total_result.scalar_one()

    trips_result = await db.execute(
        select(Trip)
        .where(Trip.user_id == current_user.id)
        .order_by(Trip.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    trips = trips_result.scalars().all()
    return PaginatedTrips(
        items=[TripListOut.model_validate(t) for t in trips],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
async def create_trip(
    body: TripCreate,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = Trip(
        user_id=current_user.id,
        **body.model_dump(),
    )
    db.add(trip)
    await db.commit()
    await db.refresh(trip)
    result = await db.execute(
        select(Trip).where(Trip.id == trip.id).options(selectinload(Trip.waypoints))
    )
    return TripOut.model_validate(result.scalar_one())


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = await _get_owned_trip(trip_id, current_user.id, db)
    return TripOut.model_validate(trip)


@router.patch("/{trip_id}", response_model=TripOut)
async def update_trip(
    trip_id: uuid.UUID,
    body: TripUpdate,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = await _get_owned_trip(trip_id, current_user.id, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(trip, field, value)
    await db.commit()
    await db.refresh(trip)
    result = await db.execute(
        select(Trip).where(Trip.id == trip.id).options(selectinload(Trip.waypoints))
    )
    return TripOut.model_validate(result.scalar_one())


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    trip = await _get_owned_trip(trip_id, current_user.id, db)
    await db.delete(trip)
    await db.commit()
