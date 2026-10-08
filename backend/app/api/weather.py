import asyncio
import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool

from app.core.deps import CurrentUser
from app.core.limiter import limiter
from app.core.trips import get_owned_trip
from app.db.session import get_db
from app.models.logistics import WeatherCache
from app.models.trip import ItineraryDay, Trip
from app.schemas.logistics import DayWeatherOut
from app.services import weather as weather_svc
from app.services.export_formats import effective_day_date
from app.services.navigation import day_stops

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips/{trip_id}", tags=["weather"])

DB = Annotated[AsyncSession, Depends(get_db)]

CACHE_TTL = timedelta(hours=3)


def _cell(value: float) -> str:
    """Coordinates rounded to 2 decimals (~1 km) so nearby stops share a cache row."""
    return f"{value:.2f}"


async def get_trip_weather(db: AsyncSession, trip: Trip) -> dict[str, dict[str, Any]]:
    """Forecast per dated itinerary day within Open-Meteo's 16-day window, keyed by day id.

    Looked up at the day's last stop (where the user sleeps). Days outside the window,
    without stops, or whose fetch fails are simply omitted — weather is never load-bearing.
    """
    today = datetime.now(ZoneInfo(trip.timezone)).date()
    horizon = today + timedelta(days=weather_svc.FORECAST_DAYS - 1)

    wanted: list[tuple[ItineraryDay, date, float, float]] = []
    for day in sorted(trip.itinerary_days, key=lambda d: d.day_number):
        day_date = effective_day_date(trip, day)
        stops = day_stops(day.waypoints)
        if day_date is None or not (today <= day_date <= horizon) or not stops:
            continue
        wanted.append((day, day_date, float(stops[-1].lat), float(stops[-1].lng)))
    if not wanted:
        return {}

    now = datetime.now(UTC)
    payloads: dict[tuple[str, str, date], dict[str, Any]] = {}
    missing: list[tuple[str, str, date, float, float]] = []
    for _, day_date, lat, lng in wanted:
        key = (_cell(lat), _cell(lng), day_date)
        if key in payloads or any(m[:3] == key for m in missing):
            continue
        row = (
            await db.execute(
                select(WeatherCache).where(
                    WeatherCache.lat_key == key[0],
                    WeatherCache.lng_key == key[1],
                    WeatherCache.date == day_date,
                )
            )
        ).scalar_one_or_none()
        if row is not None and now - row.fetched_at < CACHE_TTL:
            payloads[key] = row.payload
        else:
            missing.append((*key, lat, lng))

    results = await asyncio.gather(
        *(run_in_threadpool(weather_svc.fetch_day, lat, lng, d) for _, _, d, lat, lng in missing),
        return_exceptions=True,
    )
    for (lat_key, lng_key, d, _, _), result in zip(missing, results, strict=True):
        if isinstance(result, BaseException):
            logger.warning("weather fetch failed: %s", result)
            continue
        payloads[(lat_key, lng_key, d)] = result
        stmt = insert(WeatherCache).values(
            lat_key=lat_key, lng_key=lng_key, date=d, payload=result
        )
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["lat_key", "lng_key", "date"],
                set_={"payload": stmt.excluded.payload, "fetched_at": now},
            )
        )
    await db.commit()

    out: dict[str, dict[str, Any]] = {}
    for day, day_date, lat, lng in wanted:
        payload = payloads.get((_cell(lat), _cell(lng), day_date))
        if payload is None:
            continue
        scheduled = [w for w in day.waypoints if w.scheduled_arrival_time is not None]
        last = max(scheduled, key=lambda w: w.scheduled_arrival_time, default=None)  # type: ignore[arg-type,return-value]
        out[str(day.id)] = {
            **payload,
            "after_dark": weather_svc.arrives_after_dark(
                last.scheduled_arrival_time if last else None,
                last.stop_duration_minutes if last else None,
                payload.get("sunset"),
            ),
        }
    return out


@router.get("/weather", response_model=dict[str, DayWeatherOut])
@limiter.limit("60/hour")
async def trip_weather(
    request: Request, trip_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> dict[str, dict[str, Any]]:
    trip = await get_owned_trip(
        db,
        trip_id,
        current_user.id,
        selectinload(Trip.itinerary_days).selectinload(ItineraryDay.waypoints),
    )
    return await get_trip_weather(db, trip)
