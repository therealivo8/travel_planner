import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.core.deps import CurrentUser
from app.core.limiter import limiter
from app.core.objects import queue_object_deletes
from app.core.trip_access import TripRole, get_trip_for, owned_by_id
from app.db.session import get_db
from app.models.memories import TripPhoto
from app.models.trip import ItineraryDay, Trip, Waypoint
from app.models.user import User
from app.schemas.memories import (
    PhotoConfirm,
    PhotoOut,
    PhotoUpdate,
    UploadUrlOut,
    UploadUrlRequest,
)
from app.services import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}/photos", tags=["photos"])

DB = Annotated[AsyncSession, Depends(get_db)]

NOT_CONFIGURED = HTTPException(
    status.HTTP_503_SERVICE_UNAVAILABLE, detail="Photo storage isn't set up on this server."
)


def photo_url(key: str, *, public: bool) -> str:
    """Public R2 domain only for trips whose recap is shared; otherwise a 1-hour presigned URL."""
    if public:
        url = storage.public_url(key)
        if url:
            return url
    return storage.presign_get(key)


def to_out(photo: TripPhoto, *, public: bool) -> PhotoOut:
    return PhotoOut(
        id=photo.id,
        waypoint_id=photo.waypoint_id,
        itinerary_day_id=photo.itinerary_day_id,
        width=photo.width,
        height=photo.height,
        caption=photo.caption,
        taken_at=photo.taken_at,
        url=photo_url(photo.object_key, public=public),
    )


async def _check_links(
    db: AsyncSession, trip_id: uuid.UUID, waypoint_id: uuid.UUID | None, day_id: uuid.UUID | None
) -> None:
    if waypoint_id is not None:
        found = await db.execute(
            select(Waypoint.id).where(Waypoint.id == waypoint_id, Waypoint.trip_id == trip_id)
        )
        if found.scalar_one_or_none() is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Stop not found")
    if day_id is not None:
        found = await db.execute(
            select(ItineraryDay.id).where(ItineraryDay.id == day_id, ItineraryDay.trip_id == trip_id)
        )
        if found.scalar_one_or_none() is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Day not found")


async def _check_limits(db: AsyncSession, trip: Trip, extra_bytes: int) -> None:
    if extra_bytes > settings.photo_max_upload_bytes:
        mb = settings.photo_max_upload_bytes // (1024 * 1024)
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail=f"Photos can be at most {mb} MB.")
    per_trip = (
        await db.execute(select(func.count()).select_from(TripPhoto).where(TripPhoto.trip_id == trip.id))
    ).scalar_one()
    if per_trip >= settings.photos_per_trip:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"This trip has reached the {settings.photos_per_trip}-photo limit.",
        )
    per_user = (
        await db.execute(
            select(func.count())
            .select_from(TripPhoto)
            .join(Trip, Trip.id == TripPhoto.trip_id)
            .where(owned_by_id(trip.user_id))
        )
    ).scalar_one()
    if per_user >= settings.photos_per_user:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"You've reached the {settings.photos_per_user}-photo limit across all trips.",
        )


@router.post("/upload-url", response_model=UploadUrlOut)
@limiter.limit("120/hour")
async def create_upload_url(
    request: Request, trip_id: uuid.UUID, body: UploadUrlRequest, current_user: CurrentUser, db: DB
) -> UploadUrlOut:
    """Step 1: approve an upload and hand back a presigned PUT URL. The bytes go straight
    from the browser to R2 and never touch this server."""
    if not storage.is_configured():
        raise NOT_CONFIGURED
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
    await _check_links(db, trip_id, body.waypoint_id, body.itinerary_day_id)
    await _check_limits(db, trip, body.bytes)

    key = f"trips/{trip_id}/{uuid.uuid4()}.{storage.ALLOWED_CONTENT_TYPES[body.content_type]}"
    url = await run_in_threadpool(storage.presign_put, key, body.content_type, body.bytes)
    return UploadUrlOut(object_key=key, upload_url=url, headers={"Content-Type": body.content_type})


@router.post("", response_model=PhotoOut, status_code=status.HTTP_201_CREATED)
async def confirm_upload(
    trip_id: uuid.UUID, body: PhotoConfirm, current_user: CurrentUser, db: DB
) -> PhotoOut:
    """Step 2: record a finished upload (after checking it really reached R2)."""
    if not storage.is_configured():
        raise NOT_CONFIGURED
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
    if not body.object_key.startswith(f"trips/{trip_id}/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid object key")
    await _check_links(db, trip_id, body.waypoint_id, body.itinerary_day_id)
    await _check_limits(db, trip, body.bytes)

    size = await run_in_threadpool(storage.object_size, body.object_key)
    if size is None or size != body.bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The uploaded file wasn't found")

    photo = TripPhoto(trip_id=trip_id, **body.model_dump())
    db.add(photo)
    # Atomic increment, so concurrent uploads can't lose updates.
    await db.execute(
        # Storage is the trip owner's, whoever (owner or editor) uploaded the photo.
        update(User).where(User.id == trip.user_id).values(storage_bytes=User.storage_bytes + body.bytes)
    )
    await db.commit()
    await db.refresh(photo)
    return to_out(photo, public=trip.share_recap)


@router.get("", response_model=list[PhotoOut])
async def list_photos(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> list[PhotoOut]:
    trip = await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    if not storage.is_configured():
        return []
    rows = (
        await db.execute(
            select(TripPhoto)
            .where(TripPhoto.trip_id == trip_id)
            .order_by(TripPhoto.taken_at.nulls_last(), TripPhoto.created_at)
        )
    ).scalars()
    return [to_out(p, public=trip.share_recap) for p in rows]


@router.patch("/{photo_id}", response_model=PhotoOut)
async def update_photo(
    trip_id: uuid.UUID, photo_id: uuid.UUID, body: PhotoUpdate, current_user: CurrentUser, db: DB
) -> PhotoOut:
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
    photo = await _get_photo(db, trip_id, photo_id)
    photo.caption = body.caption
    await db.commit()
    return to_out(photo, public=trip.share_recap)


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(
    trip_id: uuid.UUID, photo_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    trip = await get_trip_for(trip_id, current_user, db, TripRole.EDITOR)
    photo = await _get_photo(db, trip_id, photo_id)
    # Queue the R2 delete in the same transaction: a failed R2 call can't block this.
    await queue_object_deletes(db, [photo.object_key])
    await db.execute(
        update(User)
        .where(User.id == trip.user_id)
        .values(storage_bytes=func.greatest(User.storage_bytes - photo.bytes, 0))
    )
    await db.delete(photo)
    await db.commit()


async def _get_photo(db: AsyncSession, trip_id: uuid.UUID, photo_id: uuid.UUID) -> TripPhoto:
    photo = (
        await db.execute(select(TripPhoto).where(TripPhoto.id == photo_id, TripPhoto.trip_id == trip_id))
    ).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Photo not found")
    return photo
