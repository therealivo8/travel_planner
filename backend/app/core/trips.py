import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import Trip


async def get_owned_trip(
    db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID, *options: Any
) -> Trip:
    """The user's trip (404 otherwise), optionally with loader options."""
    result = await db.execute(
        select(Trip).where(Trip.id == trip_id, Trip.user_id == user_id).options(*options)
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip
