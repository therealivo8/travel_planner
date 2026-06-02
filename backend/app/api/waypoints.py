import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import Trip, Waypoint
from app.schemas.trip import ReorderWaypointsRequest, WaypointCreate, WaypointOut, WaypointUpdate

router = APIRouter(prefix="/trips/{trip_id}/waypoints", tags=["waypoints"])

DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_owned_trip_bare(trip_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Trip:
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == user_id)
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


async def _get_owned_waypoint(
    waypoint_id: uuid.UUID, trip_id: uuid.UUID, db: AsyncSession
) -> Waypoint:
    result = await db.execute(
        select(Waypoint).where(Waypoint.id == waypoint_id, Waypoint.trip_id == trip_id)
    )
    wp = result.scalar_one_or_none()
    if wp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Waypoint not found")
    return wp


@router.get("", response_model=list[WaypointOut])
async def list_waypoints(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> list[WaypointOut]:
    await _get_owned_trip_bare(trip_id, current_user.id, db)
    result = await db.execute(
        select(Waypoint).where(Waypoint.trip_id == trip_id).order_by(Waypoint.position)
    )
    return [WaypointOut.model_validate(w) for w in result.scalars().all()]


@router.post("", response_model=WaypointOut, status_code=status.HTTP_201_CREATED)
async def add_waypoint(
    trip_id: uuid.UUID,
    body: WaypointCreate,
    current_user: CurrentUser,
    db: DB,
) -> WaypointOut:
    await _get_owned_trip_bare(trip_id, current_user.id, db)
    count_result = await db.execute(
        select(Waypoint).where(Waypoint.trip_id == trip_id)
    )
    position = len(count_result.scalars().all())
    waypoint = Waypoint(trip_id=trip_id, position=position, **body.model_dump())
    db.add(waypoint)
    await db.commit()
    await db.refresh(waypoint)
    return WaypointOut.model_validate(waypoint)


@router.patch("/{waypoint_id}", response_model=WaypointOut)
async def update_waypoint(
    trip_id: uuid.UUID,
    waypoint_id: uuid.UUID,
    body: WaypointUpdate,
    current_user: CurrentUser,
    db: DB,
) -> WaypointOut:
    await _get_owned_trip_bare(trip_id, current_user.id, db)
    waypoint = await _get_owned_waypoint(waypoint_id, trip_id, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(waypoint, field, value)
    await db.commit()
    await db.refresh(waypoint)
    return WaypointOut.model_validate(waypoint)


@router.delete("/{waypoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_waypoint(
    trip_id: uuid.UUID,
    waypoint_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    await _get_owned_trip_bare(trip_id, current_user.id, db)
    waypoint = await _get_owned_waypoint(waypoint_id, trip_id, db)
    deleted_position = waypoint.position
    await db.delete(waypoint)

    # compact positions after the deleted one
    remaining_result = await db.execute(
        select(Waypoint)
        .where(Waypoint.trip_id == trip_id, Waypoint.position > deleted_position)
        .order_by(Waypoint.position)
    )
    for wp in remaining_result.scalars().all():
        wp.position -= 1

    await db.commit()


@router.post("/reorder", response_model=list[WaypointOut])
async def reorder_waypoints(
    trip_id: uuid.UUID,
    body: ReorderWaypointsRequest,
    current_user: CurrentUser,
    db: DB,
) -> list[WaypointOut]:
    await _get_owned_trip_bare(trip_id, current_user.id, db)
    existing_result = await db.execute(
        select(Waypoint).where(Waypoint.trip_id == trip_id)
    )
    waypoints = {wp.id: wp for wp in existing_result.scalars().all()}

    if set(body.ordered_ids) != set(waypoints.keys()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="ordered_ids must contain exactly the trip's waypoint IDs",
        )

    for new_pos, wp_id in enumerate(body.ordered_ids):
        waypoints[wp_id].position = new_pos

    await db.commit()
    result = await db.execute(
        select(Waypoint).where(Waypoint.trip_id == trip_id).order_by(Waypoint.position)
    )
    return [WaypointOut.model_validate(w) for w in result.scalars().all()]
