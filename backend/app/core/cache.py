"""Shared Postgres caches for isochrones and discovery results (Phase 14, Part C).

Isochrones derive from OpenStreetMap (ODbL) and may be cached freely. Google Places
content may only be cached temporarily, hence the short discovery TTL. Expired rows are
deleted lazily on read; stored suggestions are separately purged by app.core.cleanup.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.budget import DiscoveryCache, IsochroneCache


def origin_key(lat: float, lng: float) -> str:
    """Lat/lng rounded to 3 decimals (~110 m), so nearby repeats share a cache entry."""
    return f"{lat:.3f},{lng:.3f}"


def _bounded(key: str) -> str:
    return key if len(key) <= 128 else "h:" + hashlib.sha1(key.encode()).hexdigest()


def _cats(categories: list[str] | None) -> str:
    return ",".join(sorted(set(categories or [])))


def radius_cache_key(
    lat: float, lng: float, minutes: int, categories: list[str] | None
) -> str:
    return _bounded(f"radius:{origin_key(lat, lng)}:{minutes}:{_cats(categories)}")


def corridor_cache_key(
    route_polyline: str, max_detour_minutes: int, categories: list[str] | None
) -> str:
    # Hash the polyline, not the trip id: two trips on the same route share the cache.
    digest = hashlib.sha1(route_polyline.encode()).hexdigest()
    return _bounded(f"corridor:{digest}:{max_detour_minutes}:{_cats(categories)}")


async def get_isochrone(
    db: AsyncSession, lat: float, lng: float, minutes: int
) -> dict[str, Any] | None:
    key = origin_key(lat, lng)
    row = (
        await db.execute(
            select(IsochroneCache).where(
                IsochroneCache.origin_key == key, IsochroneCache.minutes == minutes
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.created_at < datetime.now(UTC) - timedelta(days=settings.isochrone_cache_ttl_days):
        await db.execute(
            delete(IsochroneCache).where(
                IsochroneCache.origin_key == key, IsochroneCache.minutes == minutes
            )
        )
        await db.commit()
        return None
    return row.geojson


async def put_isochrone(
    db: AsyncSession, lat: float, lng: float, minutes: int, geojson: dict[str, Any]
) -> None:
    stmt = insert(IsochroneCache).values(
        origin_key=origin_key(lat, lng), minutes=minutes, geojson=geojson
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["origin_key", "minutes"],
            set_={"geojson": stmt.excluded.geojson, "created_at": datetime.now(UTC)},
        )
    )
    await db.commit()


async def get_discovery(db: AsyncSession, key: str) -> tuple[dict[str, Any], datetime] | None:
    row = (
        await db.execute(select(DiscoveryCache).where(DiscoveryCache.cache_key == key))
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.created_at < datetime.now(UTC) - timedelta(days=settings.discovery_cache_ttl_days):
        await db.execute(delete(DiscoveryCache).where(DiscoveryCache.cache_key == key))
        await db.commit()
        return None
    return row.payload, row.created_at


async def put_discovery(db: AsyncSession, key: str, payload: dict[str, Any]) -> None:
    stmt = insert(DiscoveryCache).values(cache_key=key, payload=payload)
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["cache_key"],
            set_={"payload": stmt.excluded.payload, "created_at": datetime.now(UTC)},
        )
    )
    await db.commit()
