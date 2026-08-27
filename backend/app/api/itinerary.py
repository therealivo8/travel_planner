import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import ItineraryDay, Trip, Waypoint
from app.schemas.trip import (
    AssignWaypointsRequest,
    ItineraryDayCreate,
    ItineraryDayOut,
    ItineraryDayUpdate,
    ItineraryOut,
    ItineraryWaypointOut,
    SetArrivalTimeRequest,
)

router = APIRouter(prefix="/trips/{trip_id}/itinerary", tags=["itinerary"])

DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_owned_trip(trip_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Trip:
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == user_id)
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


async def _load_itinerary(trip_id: uuid.UUID, db: AsyncSession) -> tuple[list[ItineraryDay], list[Waypoint]]:
    days_result = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.trip_id == trip_id)
        .options(selectinload(ItineraryDay.waypoints))
        .order_by(ItineraryDay.day_number)
    )
    days = list(days_result.scalars().all())

    unscheduled_result = await db.execute(
        select(Waypoint)
        .where(Waypoint.trip_id == trip_id, Waypoint.itinerary_day_id.is_(None))
        .order_by(Waypoint.position)
    )
    unscheduled = list(unscheduled_result.scalars().all())
    return days, unscheduled


def _waypoint_to_itinerary_out(wp: Waypoint) -> ItineraryWaypointOut:
    return ItineraryWaypointOut(
        id=wp.id,
        label=wp.label,
        address=wp.address,
        position=wp.position,
        day_position=wp.day_position,
        scheduled_arrival_time=wp.scheduled_arrival_time,
        drive_seconds_from_prev=wp.drive_seconds_from_prev,
    )


def _day_to_out(day: ItineraryDay) -> ItineraryDayOut:
    # day_position is only set once a waypoint has been explicitly ordered within
    # this day; fall back to the trip-wide position for waypoints that haven't.
    sorted_wps = sorted(
        day.waypoints, key=lambda w: (w.day_position is None, w.day_position, w.position)
    )
    return ItineraryDayOut(
        id=day.id,
        trip_id=day.trip_id,
        day_number=day.day_number,
        date=day.date,
        title=day.title,
        notes=day.notes,
        waypoints=[_waypoint_to_itinerary_out(w) for w in sorted_wps],
    )


@router.get("", response_model=ItineraryOut)
async def get_itinerary(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> ItineraryOut:
    await _get_owned_trip(trip_id, current_user.id, db)
    days, unscheduled = await _load_itinerary(trip_id, db)
    return ItineraryOut(
        trip_id=trip_id,
        days=[_day_to_out(d) for d in days],
        unscheduled_waypoints=[_waypoint_to_itinerary_out(w) for w in unscheduled],
    )


@router.post("/days", response_model=ItineraryDayOut, status_code=status.HTTP_201_CREATED)
async def create_day(
    trip_id: uuid.UUID,
    body: ItineraryDayCreate,
    current_user: CurrentUser,
    db: DB,
) -> ItineraryDayOut:
    await _get_owned_trip(trip_id, current_user.id, db)

    # Determine next day_number
    result = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.trip_id == trip_id)
        .order_by(ItineraryDay.day_number.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    next_number = (last.day_number + 1) if last else 1

    day = ItineraryDay(
        trip_id=trip_id,
        day_number=next_number,
        title=body.title,
        date=body.date,
        notes=body.notes,
    )
    db.add(day)
    await db.commit()
    await db.refresh(day)

    result2 = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.id == day.id)
        .options(selectinload(ItineraryDay.waypoints))
    )
    return _day_to_out(result2.scalar_one())


@router.patch("/days/{day_id}", response_model=ItineraryDayOut)
async def update_day(
    trip_id: uuid.UUID,
    day_id: uuid.UUID,
    body: ItineraryDayUpdate,
    current_user: CurrentUser,
    db: DB,
) -> ItineraryDayOut:
    await _get_owned_trip(trip_id, current_user.id, db)

    result = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.id == day_id, ItineraryDay.trip_id == trip_id)
        .options(selectinload(ItineraryDay.waypoints))
    )
    day = result.scalar_one_or_none()
    if day is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(day, field, value)
    await db.commit()
    await db.refresh(day)

    result2 = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.id == day.id)
        .options(selectinload(ItineraryDay.waypoints))
    )
    return _day_to_out(result2.scalar_one())


@router.delete("/days/{day_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_day(
    trip_id: uuid.UUID,
    day_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    await _get_owned_trip(trip_id, current_user.id, db)

    result = await db.execute(
        select(ItineraryDay).where(ItineraryDay.id == day_id, ItineraryDay.trip_id == trip_id)
    )
    day = result.scalar_one_or_none()
    if day is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")

    # Unschedule waypoints before deleting
    await db.execute(
        update(Waypoint)
        .where(Waypoint.itinerary_day_id == day_id)
        .values(itinerary_day_id=None, scheduled_arrival_time=None, day_position=None)
    )

    await db.delete(day)
    await db.commit()

    # Renumber remaining days
    remaining_result = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.trip_id == trip_id)
        .order_by(ItineraryDay.day_number)
    )
    remaining = list(remaining_result.scalars().all())
    for i, d in enumerate(remaining, start=1):
        d.day_number = i
    await db.commit()


@router.post("/days/{day_id}/assign", response_model=ItineraryDayOut)
async def assign_waypoints(
    trip_id: uuid.UUID,
    day_id: uuid.UUID,
    body: AssignWaypointsRequest,
    current_user: CurrentUser,
    db: DB,
) -> ItineraryDayOut:
    await _get_owned_trip(trip_id, current_user.id, db)

    result = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.id == day_id, ItineraryDay.trip_id == trip_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")

    if body.waypoint_ids:
        values: dict[str, object] = {"itinerary_day_id": day_id}
        # Only touch scheduled_arrival_time if the caller explicitly set it —
        # a reassign/reorder call that omits it must not wipe an existing time.
        if "scheduled_arrival_time" in body.model_fields_set:
            values["scheduled_arrival_time"] = body.scheduled_arrival_time
        await db.execute(
            update(Waypoint)
            .where(Waypoint.id.in_(body.waypoint_ids), Waypoint.trip_id == trip_id)
            .values(**values)
        )
        await db.commit()

    if body.ordered_waypoint_ids:
        for pos, wp_id in enumerate(body.ordered_waypoint_ids):
            await db.execute(
                update(Waypoint)
                .where(Waypoint.id == wp_id, Waypoint.trip_id == trip_id)
                .values(day_position=pos)
            )
        await db.commit()

    result2 = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.id == day_id)
        .options(selectinload(ItineraryDay.waypoints))
    )
    return _day_to_out(result2.scalar_one())


@router.delete("/days/{day_id}/waypoints/{waypoint_id}", response_model=ItineraryDayOut)
async def unassign_waypoint(
    trip_id: uuid.UUID,
    day_id: uuid.UUID,
    waypoint_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> ItineraryDayOut:
    await _get_owned_trip(trip_id, current_user.id, db)

    result = await db.execute(
        select(ItineraryDay).where(ItineraryDay.id == day_id, ItineraryDay.trip_id == trip_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")

    await db.execute(
        update(Waypoint)
        .where(
            Waypoint.id == waypoint_id,
            Waypoint.trip_id == trip_id,
            Waypoint.itinerary_day_id == day_id,
        )
        .values(itinerary_day_id=None, scheduled_arrival_time=None, day_position=None)
    )
    await db.commit()

    result2 = await db.execute(
        select(ItineraryDay)
        .where(ItineraryDay.id == day_id)
        .options(selectinload(ItineraryDay.waypoints))
    )
    return _day_to_out(result2.scalar_one())


@router.patch("/waypoints/{waypoint_id}/arrival-time", response_model=ItineraryWaypointOut)
async def set_arrival_time(
    trip_id: uuid.UUID,
    waypoint_id: uuid.UUID,
    body: SetArrivalTimeRequest,
    current_user: CurrentUser,
    db: DB,
) -> ItineraryWaypointOut:
    await _get_owned_trip(trip_id, current_user.id, db)

    result = await db.execute(
        select(Waypoint).where(Waypoint.id == waypoint_id, Waypoint.trip_id == trip_id)
    )
    waypoint = result.scalar_one_or_none()
    if waypoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Waypoint not found")

    waypoint.scheduled_arrival_time = body.scheduled_arrival_time
    await db.commit()
    await db.refresh(waypoint)
    return _waypoint_to_itinerary_out(waypoint)
