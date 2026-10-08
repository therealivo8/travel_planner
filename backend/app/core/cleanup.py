"""Daily purge of stored Google-derived suggestions and expired cache rows.

Google's terms only allow caching most Places content temporarily. Selected suggestions
have already become waypoints (user data plus place_id) and are kept.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, delete

from app.config import settings
from app.db.session import AsyncSessionLocal
from app.models.budget import DiscoveryCache, IsochroneCache
from app.models.trip import CorridorSuggestion, RadiusSuggestion

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60


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
        await db.commit()
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
