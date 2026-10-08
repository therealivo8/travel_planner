"""Daily purge of stored Google-derived suggestions and expired cache rows.

Google's terms only allow caching most Places content temporarily. Selected suggestions
have already become waypoints (user data plus place_id) and are kept.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select, update

from app.config import settings
from app.db.session import AsyncSessionLocal
from app.models.budget import DiscoveryCache, IsochroneCache
from app.models.collab import TripActivity
from app.models.memories import PendingObjectDelete
from app.models.trip import CorridorSuggestion, RadiusSuggestion

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60


MAX_DELETE_ATTEMPTS = 20
DELETE_BATCH = 500


async def process_pending_object_deletes() -> int:
    """Empty the R2 delete queue. Rows stay queued on failure and are retried next cycle;
    after MAX_DELETE_ATTEMPTS they're dropped and logged rather than retried forever."""
    from starlette.concurrency import run_in_threadpool

    from app.services import storage

    if not storage.is_configured():
        return 0
    async with AsyncSessionLocal() as db:
        keys = list(
            (
                await db.execute(
                    select(PendingObjectDelete.object_key)
                    .order_by(PendingObjectDelete.created_at)
                    .limit(DELETE_BATCH)
                )
            ).scalars()
        )
        if not keys:
            return 0
        try:
            await run_in_threadpool(storage.delete_objects, keys)
        except Exception:
            logger.exception("R2 delete failed; will retry next cycle")
            await db.execute(
                update(PendingObjectDelete)
                .where(PendingObjectDelete.object_key.in_(keys))
                .values(attempts=PendingObjectDelete.attempts + 1)
            )
            await db.execute(
                delete(PendingObjectDelete).where(PendingObjectDelete.attempts >= MAX_DELETE_ATTEMPTS)
            )
            await db.commit()
            return 0
        await db.execute(delete(PendingObjectDelete).where(PendingObjectDelete.object_key.in_(keys)))
        await db.commit()
        return len(keys)


async def run_cleanup() -> dict[str, int]:
    now = datetime.now(UTC)
    suggestion_cutoff = now - timedelta(days=settings.suggestion_retention_days)
    counts: dict[str, int] = {}
    async with AsyncSessionLocal() as db:
        for name, model in (
            ("radius_suggestions", RadiusSuggestion),
            ("corridor_suggestions", CorridorSuggestion),
        ):
            res = await db.execute(
                delete(model).where(
                    model.selected.is_(False), model.created_at < suggestion_cutoff
                )
            )
            counts[name] = cast(CursorResult[Any], res).rowcount or 0
        res = await db.execute(
            delete(DiscoveryCache).where(
                DiscoveryCache.created_at < now - timedelta(days=settings.discovery_cache_ttl_days)
            )
        )
        counts["discovery_cache"] = cast(CursorResult[Any], res).rowcount or 0
        res = await db.execute(
            delete(IsochroneCache).where(
                IsochroneCache.created_at
                < now - timedelta(days=settings.isochrone_cache_ttl_days)
            )
        )
        counts["isochrone_cache"] = cast(CursorResult[Any], res).rowcount or 0
        res = await db.execute(
            delete(TripActivity).where(TripActivity.created_at < now - timedelta(days=90))
        )
        counts["trip_activity"] = cast(CursorResult[Any], res).rowcount or 0
        await db.commit()
    counts["r2_objects_deleted"] = await process_pending_object_deletes()
    return counts


async def cleanup_loop() -> None:
    """Runs once at startup, then daily. Failures are logged, never fatal."""
    while True:
        try:
            counts = await run_cleanup()
            logger.info("cleanup.done", extra={"event": "cleanup.done", **counts})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("cleanup failed")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
