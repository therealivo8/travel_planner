import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.trip_access import TripRole, display_name, get_trip_for, touch_trip
from app.db.session import get_db
from app.models.trip import Waypoint
from app.schemas.memories import CheckInRequest
from app.schemas.trip import ReorderWaypointsRequest, WaypointCreate, WaypointOut, WaypointUpdate

router = APIRouter(prefix="/trips/{trip_id}/waypoints", tags=["waypoints"])

DB = Annotated[AsyncSession, Depends(get_db)]


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
    await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
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
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
    count_result = await db.execute(
        select(Waypoint).where(Waypoint.trip_id == trip_id)
    )
    position = len(count_result.scalars().all())
    data = body.model_dump()
    if data["stop_duration_minutes"] is None:
        data["stop_duration_minutes"] = current_user.default_stop_minutes
    waypoint = Waypoint(trip_id=trip_id, position=position, **data)
    db.add(waypoint)
    await touch_trip(db, trip, current_user, ("waypoint_added", f"{display_name(current_user)} added {body.label or body.address} to the trip"))
    await db.commit()
    await db.refresh(waypoint)
    return WaypointOut.model_validate(waypoint)


@router.post("/{waypoint_id}/check-in", response_model=WaypointOut)
async def check_in(
    trip_id: uuid.UUID,
    waypoint_id: uuid.UUID,
    body: CheckInRequest,
    current_user: CurrentUser,
    db: DB,
) -> WaypointOut:
    """Mark a stop arrived/skipped (or undo). Idempotent, so an offline queue can safely
    replay it: the same action twice leaves the same state."""
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
    waypoint = await _get_owned_waypoint(waypoint_id, trip_id, db)
    now = datetime.now(UTC)
    # Trust the client's timestamp (it may be a replayed offline check-in) but never the future.
    at = min(body.at, now) if body.at else now
    if body.action == "arrived":
        waypoint.visited_at, waypoint.skipped = at, False
    elif body.action == "skipped":
        waypoint.visited_at, waypoint.skipped = None, True
    else:
        waypoint.visited_at, waypoint.skipped = None, False
    await touch_trip(db, trip, current_user, ("check_in", f"{display_name(current_user)} marked {waypoint.label or waypoint.address} as {body.action}"))
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
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
    waypoint = await _get_owned_waypoint(waypoint_id, trip_id, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(waypoint, field, value)
    await touch_trip(db, trip, current_user, ("waypoint_updated", f"{display_name(current_user)} edited {waypoint.label or waypoint.address}"))
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
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
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

    await touch_trip(db, trip, current_user, ("waypoint_removed", f"{display_name(current_user)} removed {waypoint.label or waypoint.address} from the trip"))

    await db.commit()


@router.post("/reorder", response_model=list[WaypointOut])
async def reorder_waypoints(
    trip_id: uuid.UUID,
    body: ReorderWaypointsRequest,
    current_user: CurrentUser,
    db: DB,
) -> list[WaypointOut]:
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
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

    await touch_trip(db, trip, current_user, ("waypoints_reordered", f"{display_name(current_user)} reordered the stops"))

    await db.commit()
    result = await db.execute(
        select(Waypoint).where(Waypoint.trip_id == trip_id).order_by(Waypoint.position)
    )
    return [WaypointOut.model_validate(w) for w in result.scalars().all()]
