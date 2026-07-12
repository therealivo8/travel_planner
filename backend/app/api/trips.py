import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import Trip, Waypoint
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
    status_filter: Literal["draft", "planned", "completed"] | None = Query(None, alias="status"),
    sort: Literal["created_at", "updated_at", "start_date"] = Query("created_at"),
) -> PaginatedTrips:
    offset = (page - 1) * page_size

    base_filter = Trip.user_id == current_user.id
    if status_filter:
        base_filter = base_filter & (Trip.status == status_filter)

    total_result = await db.execute(
        select(func.count()).select_from(Trip).where(base_filter)
    )
    total = total_result.scalar_one()

    sort_col = Trip.updated_at if sort == "updated_at" else (
        Trip.start_date if sort == "start_date" else Trip.created_at
    )

    trips_result = await db.execute(
        select(Trip)
        .where(base_filter)
        .order_by(sort_col.desc().nulls_last())
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


@router.post("/{trip_id}/duplicate", response_model=TripOut, status_code=status.HTTP_201_CREATED)
async def duplicate_trip(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = await _get_owned_trip(trip_id, current_user.id, db)

    new_trip = Trip(
        user_id=current_user.id,
        title=f"Copy of {trip.title}",
        mode=trip.mode,
        status="draft",
        start_address=trip.start_address,
        start_lat=trip.start_lat,
        start_lng=trip.start_lng,
        end_address=trip.end_address,
        end_lat=trip.end_lat,
        end_lng=trip.end_lng,
        max_drive_minutes=trip.max_drive_minutes,
        notes=trip.notes,
        start_date=trip.start_date,
        cover_image_url=trip.cover_image_url,
    )
    db.add(new_trip)
    await db.flush()

    for wp in trip.waypoints:
        db.add(Waypoint(
            trip_id=new_trip.id,
            position=wp.position,
            address=wp.address,
            lat=wp.lat,
            lng=wp.lng,
            label=wp.label,
            stop_duration_minutes=wp.stop_duration_minutes,
            notes=wp.notes,
            place_id=wp.place_id,
        ))

    await db.commit()
    await db.refresh(new_trip)

    result = await db.execute(
        select(Trip).where(Trip.id == new_trip.id).options(selectinload(Trip.waypoints))
    )
    return TripOut.model_validate(result.scalar_one())
