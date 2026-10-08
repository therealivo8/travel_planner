"""Queueing of R2 object deletes. Deleting a photo, trip or account must never fail because
R2 is slow or down, so keys are recorded in pending_object_deletes in the same transaction
as the row delete, and app.core.cleanup empties the queue."""

import uuid
from collections.abc import Iterable

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memories import PendingObjectDelete, TripPhoto
from app.models.trip import Trip
from app.models.user import User


async def queue_object_deletes(db: AsyncSession, keys: Iterable[str]) -> None:
    rows = [{"object_key": k} for k in set(keys)]
    if rows:
        await db.execute(insert(PendingObjectDelete).values(rows).on_conflict_do_nothing())


async def queue_trip_photo_deletes(db: AsyncSession, trip: Trip) -> None:
    """Queue every photo object of a trip and give its bytes back to the owner's quota.
    Call before deleting the trip (its photo rows go with it via ON DELETE CASCADE)."""
    photos = (
        await db.execute(select(TripPhoto.object_key, TripPhoto.bytes).where(TripPhoto.trip_id == trip.id))
    ).all()
    if not photos:
        return
    await queue_object_deletes(db, (key for key, _ in photos))
    await db.execute(
        update(User)
        .where(User.id == trip.user_id)
        .values(storage_bytes=func.greatest(User.storage_bytes - sum(b for _, b in photos), 0))
    )


async def queue_user_photo_deletes(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Queue every photo object the user owns (before deleting the account)."""
    keys = (
        await db.execute(
            select(TripPhoto.object_key).join(Trip, Trip.id == TripPhoto.trip_id).where(Trip.user_id == user_id)
        )
    ).scalars()
    await queue_object_deletes(db, keys)
