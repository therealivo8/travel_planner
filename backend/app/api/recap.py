import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.photos import to_out
from app.core.deps import CurrentUser
from app.core.trip_access import TripRole, get_trip_for
from app.db.session import get_db
from app.models.logistics import EXPENSE_CATEGORIES, TripExpense
from app.models.memories import TripPhoto
from app.models.trip import ItineraryDay, Trip
from app.schemas.memories import PhotoOut, RecapDay, RecapOut, RecapStop
from app.services import storage
from app.services.navigation import day_stops

router = APIRouter(tags=["recap"])

DB = Annotated[AsyncSession, Depends(get_db)]

RECAP_LOAD = (selectinload(Trip.waypoints), selectinload(Trip.itinerary_days).selectinload(ItineraryDay.waypoints))


async def build_recap(db: AsyncSession, trip: Trip, *, public: bool) -> RecapOut:
    """Stats and a day-by-day timeline from stored data only (no upstream calls).

    `public` hides spending, which is private even when the recap itself is shared.
    """
    photos_by_wp: dict[uuid.UUID, list[PhotoOut]] = defaultdict(list)
    photos_by_day: dict[uuid.UUID, list[PhotoOut]] = defaultdict(list)
    photo_count = 0
    if storage.is_configured():
        rows = (
            await db.execute(
                select(TripPhoto)
                .where(TripPhoto.trip_id == trip.id)
                .order_by(TripPhoto.taken_at.nulls_last(), TripPhoto.created_at)
            )
        ).scalars()
        for p in rows:
            photo_count += 1
            out = to_out(p, public=trip.share_recap)
            if p.waypoint_id:
                photos_by_wp[p.waypoint_id].append(out)
            elif p.itinerary_day_id:
                photos_by_day[p.itinerary_day_id].append(out)

    days = []
    for day in sorted(trip.itinerary_days, key=lambda d: d.day_number):
        stops = [
            RecapStop(
                id=w.id,
                label=w.label,
                address=w.address,
                visited=w.visited_at is not None,
                skipped=w.skipped,
                visited_at=w.visited_at,
                notes=w.notes,
                photos=photos_by_wp.get(w.id, []),
            )
            for w in day_stops(day.waypoints)
        ]
        days.append(
            RecapDay(
                id=day.id,
                day_number=day.day_number,
                date=day.date,
                title=day.title,
                notes=day.notes,
                stops=stops,
                photos=photos_by_day.get(day.id, []),
            )
        )

    spent: dict[str, float] | None = None
    total: float | None = None
    if not public:
        spent = {c: 0.0 for c in EXPENSE_CATEGORIES}
        for category, amount in (
            await db.execute(select(TripExpense.category, TripExpense.amount).where(TripExpense.trip_id == trip.id))
        ).all():
            spent[category] += float(amount)
        spent = {c: round(v, 2) for c, v in spent.items()}
        total = round(sum(spent.values()), 2)

    waypoints = trip.waypoints
    return RecapOut(
        title=trip.title,
        total_distance_meters=trip.total_distance_meters,
        total_drive_seconds=trip.total_drive_seconds,
        days_count=len(trip.itinerary_days),
        stops_planned=len(waypoints),
        stops_visited=sum(1 for w in waypoints if w.visited_at is not None),
        stops_skipped=sum(1 for w in waypoints if w.skipped),
        photo_count=photo_count,
        spent_by_category=spent,
        spent_total=total,
        currency=None if public else trip.currency,
        days=days,
    )


@router.get("/trips/{trip_id}/recap", response_model=RecapOut)
async def get_recap(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> RecapOut:
    trip = await get_trip_for(trip_id, current_user, db, TripRole.VIEWER, load=RECAP_LOAD)
    return await build_recap(db, trip, public=False)
