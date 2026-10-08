import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.weather import get_trip_weather
from app.core.deps import CurrentUser
from app.core.limiter import limiter
from app.core.trips import get_owned_trip
from app.db.session import get_db
from app.models.logistics import PackingItem
from app.models.trip import CorridorSuggestion, ItineraryDay, RadiusSuggestion, Trip
from app.schemas.logistics import (
    PackingItemCreate,
    PackingItemOut,
    PackingItemUpdate,
    PackingSuggestionOut,
    PackingTemplateOut,
)
from app.services import weather as weather_svc
from app.services.packing_templates import TEMPLATES, template_items

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}/packing", tags=["packing"])

DB = Annotated[AsyncSession, Depends(get_db)]

COLD_BELOW_C = 5


async def _items(db: AsyncSession, trip_id: uuid.UUID) -> list[PackingItem]:
    rows = await db.execute(
        select(PackingItem)
        .where(PackingItem.trip_id == trip_id)
        .order_by(PackingItem.category, PackingItem.position, PackingItem.label)
    )
    return list(rows.scalars())


async def _next_position(db: AsyncSession, trip_id: uuid.UUID) -> int:
    top = (
        await db.execute(
            select(func.max(PackingItem.position)).where(PackingItem.trip_id == trip_id)
        )
    ).scalar_one()
    return 0 if top is None else min(int(top) + 1, 32000)


@router.get("", response_model=list[PackingItemOut])
async def list_items(
    trip_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[PackingItemOut]:
    await get_owned_trip(db, trip_id, current_user.id)
    return [PackingItemOut.model_validate(i) for i in await _items(db, trip_id)]


@router.post("", response_model=PackingItemOut, status_code=status.HTTP_201_CREATED)
async def add_item(
    trip_id: uuid.UUID, body: PackingItemCreate, current_user: CurrentUser, db: DB
) -> PackingItemOut:
    await get_owned_trip(db, trip_id, current_user.id)
    item = PackingItem(
        trip_id=trip_id,
        label=body.label.strip(),
        category=body.category.strip(),
        position=await _next_position(db, trip_id),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return PackingItemOut.model_validate(item)


@router.get("/templates", response_model=list[PackingTemplateOut])
async def list_templates(
    trip_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[PackingTemplateOut]:
    await get_owned_trip(db, trip_id, current_user.id)
    return [PackingTemplateOut(name=n, item_count=len(i)) for n, i in TEMPLATES.items()]


@router.post("/templates/{name}", response_model=list[PackingItemOut])
async def add_template(
    trip_id: uuid.UUID, name: str, current_user: CurrentUser, db: DB
) -> list[PackingItemOut]:
    """Insert a template's items, skipping any already on the list (case-insensitive)."""
    await get_owned_trip(db, trip_id, current_user.id)
    items = template_items(name)
    if items is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Unknown template")
    existing = {i.label.lower() for i in await _items(db, trip_id)}
    position = await _next_position(db, trip_id)
    for category, label in items:
        if label.lower() in existing:
            continue
        db.add(PackingItem(trip_id=trip_id, label=label, category=category, position=position))
        existing.add(label.lower())
        position = min(position + 1, 32000)
    await db.commit()
    return [PackingItemOut.model_validate(i) for i in await _items(db, trip_id)]


@router.get("/suggestions", response_model=list[PackingSuggestionOut])
@limiter.limit("60/hour")
async def suggestions(
    request: Request, trip_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[PackingSuggestionOut]:
    """Rule-based hints from data the app already has (a later phase may swap in AI)."""
    trip = await get_owned_trip(
        db,
        trip_id,
        current_user.id,
        selectinload(Trip.itinerary_days).selectinload(ItineraryDay.waypoints),
    )
    have = {i.label.lower() for i in await _items(db, trip_id)}

    def pending(template: str) -> bool:
        return any(label.lower() not in have for _, label in TEMPLATES[template])

    out: list[PackingSuggestionOut] = []
    try:
        forecast = list((await get_trip_weather(db, trip)).values())
    except Exception:
        logger.warning("packing suggestions: weather unavailable", exc_info=True)
        forecast = []
    if any(weather_svc.is_wet(f) for f in forecast) and pending("Rain gear"):
        out.append(PackingSuggestionOut(template="Rain gear", reason="Rain is in the forecast"))
    if any((f.get("lo") is not None and f["lo"] < COLD_BELOW_C) for f in forecast) and pending(
        "Cold weather"
    ):
        out.append(
            PackingSuggestionOut(
                template="Cold weather", reason=f"Lows below {COLD_BELOW_C}°C are forecast"
            )
        )

    # Selected suggestions outlive the 30-day cleanup, so they record what the user chose.
    park = await db.execute(
        select(RadiusSuggestion.id)
        .where(RadiusSuggestion.trip_id == trip_id, RadiusSuggestion.selected.is_(True),
               RadiusSuggestion.category == "park")
        .union_all(
            select(CorridorSuggestion.id).where(
                CorridorSuggestion.trip_id == trip_id,
                CorridorSuggestion.selected.is_(True),
                CorridorSuggestion.category == "park",
            )
        )
        .limit(1)
    )
    if park.first() is not None and pending("Camping"):
        out.append(
            PackingSuggestionOut(template="Camping", reason="Your trip includes parks or campgrounds")
        )
    return out


@router.patch("/{item_id}", response_model=PackingItemOut)
async def update_item(
    trip_id: uuid.UUID,
    item_id: uuid.UUID,
    body: PackingItemUpdate,
    current_user: CurrentUser,
    db: DB,
) -> PackingItemOut:
    await get_owned_trip(db, trip_id, current_user.id)
    item = await _get_item(db, trip_id, item_id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(item, field, value.strip() if isinstance(value, str) else value)
    await db.commit()
    await db.refresh(item)
    return PackingItemOut.model_validate(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    trip_id: uuid.UUID, item_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    await get_owned_trip(db, trip_id, current_user.id)
    await db.delete(await _get_item(db, trip_id, item_id))
    await db.commit()


async def _get_item(db: AsyncSession, trip_id: uuid.UUID, item_id: uuid.UUID) -> PackingItem:
    item = (
        await db.execute(
            select(PackingItem).where(PackingItem.id == item_id, PackingItem.trip_id == trip_id)
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Item not found")
    return item
