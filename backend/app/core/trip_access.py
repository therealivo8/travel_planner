"""The single place that decides who may touch a trip (Phase 19, Part A).

Every trip-scoped endpoint resolves its trip through `get_trip_for`, so ownership, member
roles and "does this trip exist" are decided in one function instead of eight copies.

- Someone with no access at all gets **404**, never 403, so the response doesn't reveal
  that the trip exists.
- A member whose role is too low for the action gets **403**.
- Mutating endpoints also check the optimistic-concurrency version (`If-Match`), and call
  `touch_trip` to bump it.
"""

import uuid
from contextvars import ContextVar
from enum import IntEnum
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collab import TripActivity, TripMember
from app.models.trip import Trip
from app.models.user import User


class TripRole(IntEnum):
    VIEWER = 1
    EDITOR = 2
    OWNER = 3


class VersionConflictError(Exception):
    """The caller's If-Match version is stale: someone else changed the trip first."""

    def __init__(self, current_version: int) -> None:
        super().__init__("trip was modified by someone else")
        self.current_version = current_version


# Per-request scratch space, set by the middleware in app.main: the caller's If-Match
# header on mutating requests, and (filled in by touch_trip) the trip's new version.
request_state: ContextVar[dict[str, Any] | None] = ContextVar("trip_request_state", default=None)


def display_name(user: User) -> str:
    """How a person is named to collaborators: their display name, else the part of their
    email before the @ (never the full address)."""
    return user.display_name or user.email.split("@")[0]


def owned_by(user: User) -> Any:
    """SQL filter for "trips this user owns" — for lists and stats, not for access to one trip."""
    return Trip.user_id == user.id


def accessible_to(user: User) -> Any:
    """SQL filter for every trip the user can see: their own plus those shared with them."""
    return or_(
        Trip.user_id == user.id,
        Trip.id.in_(select(TripMember.trip_id).where(TripMember.user_id == user.id)),
    )


def owned_by_id(user_id: uuid.UUID) -> Any:
    return Trip.user_id == user_id


async def get_trip_with_role(
    trip_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    min_role: TripRole = TripRole.OWNER,
    *,
    load: tuple[Any, ...] = (),
) -> tuple[Trip, TripRole]:
    row = (
        await db.execute(
            select(Trip, TripMember.role)
            .outerjoin(
                TripMember, and_(TripMember.trip_id == Trip.id, TripMember.user_id == user.id)
            )
            .where(Trip.id == trip_id)
            .options(*load)
        )
    ).first()
    role: TripRole | None = None
    if row is not None:
        trip, member_role = row
        if trip.user_id == user.id:
            role = TripRole.OWNER
        elif member_role is not None:
            role = TripRole.EDITOR if member_role == "editor" else TripRole.VIEWER
    if row is None or role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if role < min_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to do that on this trip",
        )
    state = request_state.get()
    if min_role >= TripRole.EDITOR and state and state.get("if_match") not in (None, trip.version):
        raise VersionConflictError(trip.version)
    return trip, role


async def get_trip_for(
    trip_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    min_role: TripRole = TripRole.OWNER,
    *,
    load: tuple[Any, ...] = (),
) -> Trip:
    trip, _ = await get_trip_with_role(trip_id, user, db, min_role, load=load)
    return trip


async def touch_trip(
    db: AsyncSession,
    trip: Trip,
    user: User | None = None,
    activity: tuple[str, str] | None = None,
) -> None:
    """Record a change: bump the trip's version (once per request) and log an activity line.

    The bump is a compare-and-swap against the caller's If-Match version, so two editors
    who both passed the early check can't both win: the second UPDATE matches no row and
    the request fails with a conflict instead of overwriting.
    """
    state = request_state.get()
    if state is None or state.get("version") is None:
        stmt = (
            update(Trip)
            .where(Trip.id == trip.id)
            .values(version=Trip.version + 1, updated_at=func.now())
            .returning(Trip.version)
        )
        expected = state.get("if_match") if state else None
        if expected is not None:
            stmt = stmt.where(Trip.version == expected)
        new_version = (await db.execute(stmt)).scalar_one_or_none()
        if new_version is None:
            current = (await db.execute(select(Trip.version).where(Trip.id == trip.id))).scalar_one()
            raise VersionConflictError(current)
        trip.version = new_version
        if state is not None:
            state["version"] = new_version
    # One activity line per request, even when a handler commits in several steps.
    if activity is not None and not (state and state.get("activity_logged")):
        if state is not None:
            state["activity_logged"] = True
        db.add(
            TripActivity(
                trip_id=trip.id,
                user_id=user.id if user else None,
                kind=activity[0],
                summary=activity[1],
            )
        )
