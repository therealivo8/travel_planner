import uuid
from datetime import datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.core.objects import queue_trip_photo_deletes
from app.core.trip_access import (
    TripRole,
    display_name,
    get_trip_for,
    get_trip_with_role,
    touch_trip,
)
from app.db.session import get_db
from app.models.collab import TripMember
from app.models.trip import ItineraryDay, Trip, Waypoint
from app.models.user import User
from app.schemas.trip import (
    PaginatedTrips,
    TripCreate,
    TripListOut,
    TripOut,
    TripUpdate,
)
from app.services.polyline_utils import simplify_polyline

router = APIRouter(prefix="/trips", tags=["trips"])

DB = Annotated[AsyncSession, Depends(get_db)]


async def _trip_phase(db: AsyncSession, trip: Trip) -> tuple[bool, bool]:
    """(in_progress, ended) from the itinerary dates and the trip's own timezone.

    Computed on read rather than by a cron job, and never changes the stored status: a trip
    whose last day has passed only *prompts* "Mark trip complete?".
    """
    if trip.status == "completed":
        return False, False
    first, last = (
        await db.execute(
            select(func.min(ItineraryDay.date), func.max(ItineraryDay.date)).where(
                ItineraryDay.trip_id == trip.id, ItineraryDay.date.is_not(None)
            )
        )
    ).one()
    if first is None:
        return False, False
    today = datetime.now(ZoneInfo(trip.timezone)).date()
    return first <= today <= last, today > last


def role_name(role: TripRole) -> Literal["owner", "editor", "viewer"]:
    return {TripRole.OWNER: "owner", TripRole.EDITOR: "editor", TripRole.VIEWER: "viewer"}[role]  # type: ignore[return-value]


async def _trip_out(db: AsyncSession, trip: Trip, role: TripRole, *, phase: bool = False) -> TripOut:
    out = TripOut.model_validate(trip)
    out.my_role = role_name(role)
    owner = await db.get(User, trip.user_id)
    out.owner_name = display_name(owner) if owner else None
    out.member_count = (
        await db.execute(select(func.count()).select_from(TripMember).where(TripMember.trip_id == trip.id))
    ).scalar_one()
    if phase:
        out.in_progress, out.ended = await _trip_phase(db, trip)
    return out


@router.get("", response_model=PaginatedTrips)
async def list_trips(
    current_user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Literal["draft", "planned", "completed"] | None = Query(None, alias="status"),
    sort: Literal["created_at", "updated_at", "start_date"] = Query("created_at"),
    scope: Literal["mine", "shared", "all"] = Query("mine"),
) -> PaginatedTrips:
    offset = (page - 1) * page_size

    shared_ids = select(TripMember.trip_id).where(TripMember.user_id == current_user.id)
    mine = Trip.user_id == current_user.id
    shared = Trip.id.in_(shared_ids)
    base_filter = mine if scope == "mine" else shared if scope == "shared" else or_(mine, shared)
    if status_filter:
        base_filter = base_filter & (Trip.status == status_filter)

    total = (await db.execute(select(func.count()).select_from(Trip).where(base_filter))).scalar_one()

    sort_col = Trip.updated_at if sort == "updated_at" else (
        Trip.start_date if sort == "start_date" else Trip.created_at
    )

    rows = (
        await db.execute(
            select(Trip, User.display_name, User.email, TripMember.role)
            .join(User, User.id == Trip.user_id)
            .outerjoin(
                TripMember,
                and_(TripMember.trip_id == Trip.id, TripMember.user_id == current_user.id),
            )
            .where(base_filter)
            .order_by(sort_col.desc().nulls_last())
            .offset(offset)
            .limit(page_size)
        )
    ).all()
    items = []
    for t, owner_display, owner_email, member_role in rows:
        item = TripListOut.model_validate(t)
        item.route_thumb = simplify_polyline(t.route_polyline)
        item.role = "owner" if t.user_id == current_user.id else member_role
        item.owner_name = owner_display or owner_email.split("@")[0]
        items.append(item)
    return PaginatedTrips(items=items, total=total, page=page, page_size=page_size)


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
    return await _trip_out(db, result.scalar_one(), TripRole.OWNER)


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip, role = await get_trip_with_role(
        trip_id, current_user, db, TripRole.VIEWER, load=(selectinload(Trip.waypoints),)
    )
    return await _trip_out(db, trip, role, phase=True)


@router.patch("/{trip_id}", response_model=TripOut)
async def update_trip(
    trip_id: uuid.UUID,
    body: TripUpdate,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip, role = await get_trip_with_role(
        trip_id, current_user, db, TripRole.EDITOR, load=(selectinload(Trip.waypoints),)
    )
    changes = body.model_dump(exclude_unset=True)
    # Whether the recap is public is a sharing decision, which stays with the owner.
    if "share_recap" in changes and role < TripRole.OWNER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Only the trip owner can change sharing")
    for field, value in changes.items():
        setattr(trip, field, value)
    await touch_trip(
        db, trip, current_user, ("trip_updated", f"{display_name(current_user)} updated the trip details")
    )
    await db.commit()
    result = await db.execute(
        select(Trip).where(Trip.id == trip.id).options(selectinload(Trip.waypoints))
    )
    return await _trip_out(db, result.scalar_one(), role)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> None:
    trip = await get_trip_for(
        trip_id, current_user, db, TripRole.OWNER, load=(selectinload(Trip.waypoints),)
    )
    # Photo rows cascade with the trip; their R2 objects are queued for the cleanup job so
    # an R2 outage can't block (or half-complete) this delete.
    await queue_trip_photo_deletes(db, trip)
    await db.delete(trip)
    await db.commit()


@router.post("/{trip_id}/duplicate", response_model=TripOut, status_code=status.HTTP_201_CREATED)
async def duplicate_trip(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = await get_trip_for(
        trip_id, current_user, db, TripRole.VIEWER, load=(selectinload(Trip.waypoints),)
    )

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
        # The saved route is copied too, so duplicating (e.g. the example trip) needs no
        # new Directions call.
        total_distance_meters=trip.total_distance_meters,
        total_drive_seconds=trip.total_drive_seconds,
        route_polyline=trip.route_polyline,
        vehicle_mpg=trip.vehicle_mpg,
        fuel_price_per_unit=trip.fuel_price_per_unit,
        budget_total=trip.budget_total,
        currency=trip.currency,
        timezone=trip.timezone,
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
            drive_seconds_from_prev=wp.drive_seconds_from_prev,
            distance_meters_from_prev=wp.distance_meters_from_prev,
        ))

    await db.commit()
    await db.refresh(new_trip)

    result = await db.execute(
        select(Trip).where(Trip.id == new_trip.id).options(selectinload(Trip.waypoints))
    )
    return TripOut.model_validate(result.scalar_one())
