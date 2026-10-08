"""Postgres-backed tests for the budget ledger, quotas, caches, cleanup and endpoints.

Run against a throwaway database:
    RUN_DB_TESTS=1 DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/tp_test \
        alembic upgrade head && pytest
"""

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select, text, update

from app.config import settings
from app.core import budget, cache, cleanup
from app.db.session import AsyncSessionLocal
from app.models.budget import DiscoveryCache, IsochroneCache
from app.models.trip import CorridorSuggestion, RadiusSuggestion, Trip
from app.models.user import User
from app.services import corridor as corridor_svc
from app.services import radius as radius_svc
from tests.helpers import auth, make_user

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DB_TESTS") != "1", reason="set RUN_DB_TESTS=1 with a migrated DATABASE_URL"
)


async def total(sku: str) -> int:
    async with AsyncSessionLocal() as db:
        return int(
            (
                await db.execute(
                    text("SELECT COALESCE(SUM(units),0) FROM api_usage_daily WHERE sku=:s"),
                    {"s": sku},
                )
            ).scalar_one()
        )


async def test_reserve_counts_and_refuses_over_day_budget() -> None:
    settings.api_budgets["x.sku"] = {"day": 10, "month": 100}
    async with AsyncSessionLocal() as db:
        await budget.reserve(db, "x.sku", 6)
        await db.commit()
        with pytest.raises(budget.BudgetExceeded) as err:
            await budget.reserve(db, "x.sku", 5)
        assert err.value.scope == "day"
        assert err.value.resets_at > datetime.now(UTC)
    assert await total("x.sku") == 6  # the refused increment was rolled back


async def test_reserve_enforces_month_budget_across_days() -> None:
    settings.api_budgets["x.sku"] = {"day": 100, "month": 50}
    today = budget.utc_today()
    if today.day == 1:
        pytest.skip("no earlier day in this month")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("INSERT INTO api_usage_daily (day, sku, units) VALUES (:d, 'x.sku', 45)"),
            {"d": today.replace(day=1)},
        )
        await db.commit()
        await budget.reserve(db, "x.sku", 5)
        with pytest.raises(budget.BudgetExceeded) as err:
            await budget.reserve(db, "x.sku", 1)
        assert err.value.scope == "month"


async def test_concurrent_reservations_never_exceed_budget() -> None:
    settings.api_budgets["x.sku"] = {"day": 20, "month": 1000}

    async def one() -> bool:
        async with AsyncSessionLocal() as db:
            try:
                await budget.reserve(db, "x.sku", 1)
                await db.commit()
                return True
            except budget.BudgetExceeded:
                return False

    results = await asyncio.gather(*(one() for _ in range(40)))
    assert sum(results) == 20
    assert await total("x.sku") == 20


async def test_reserve_many_is_all_or_nothing() -> None:
    settings.api_budgets["a.sku"] = {"day": 10, "month": 100}
    settings.api_budgets["b.sku"] = {"day": 1, "month": 100}
    async with AsyncSessionLocal() as db:
        with pytest.raises(budget.BudgetExceeded):
            await budget.reserve_many(db, {"a.sku": 5, "b.sku": 2})
    assert await total("a.sku") == 0


async def test_month_warning_fires_once_per_sku_per_day(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(
        budget.upstream_log, "log_budget_warning", lambda sku, *_: calls.append(sku)
    )
    settings.api_budgets["x.sku"] = {"day": 1000, "month": 100}
    async with AsyncSessionLocal() as db:
        await budget.reserve(db, "x.sku", 79)
        assert calls == []
        await budget.reserve(db, "x.sku", 1)
        await budget.reserve(db, "x.sku", 1)
        assert calls == ["x.sku"]


async def test_user_quota_survives_new_sessions_and_resets_nothing_on_refusal() -> None:
    settings.user_daily_quotas["radius_discover"] = 2
    user = await make_user()
    for expected_left in (1, 0):
        async with AsyncSessionLocal() as db:
            left = await budget.consume_user_action(db, user.id, "radius_discover")
            await db.commit()
            assert left == expected_left
    async with AsyncSessionLocal() as db:
        with pytest.raises(budget.UserQuotaExceeded):
            await budget.consume_user_action(db, user.id, "radius_discover")
    async with AsyncSessionLocal() as db:
        left = await budget.remaining_user_actions(db, user.id, ["radius_discover"])
        assert left == {"radius_discover": 0}


async def test_isochrone_cache_roundtrip_and_ttl() -> None:
    geo = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    async with AsyncSessionLocal() as db:
        assert await cache.get_isochrone(db, 40.7131, -74.0059, 30) is None
        await cache.put_isochrone(db, 40.7131, -74.0059, 30, geo)
        assert await cache.get_isochrone(db, 40.7129, -74.0061, 30) == geo
        assert await cache.get_isochrone(db, 40.7131, -74.0059, 45) is None
        await db.execute(
            update(IsochroneCache).values(created_at=datetime.now(UTC) - timedelta(days=91))
        )
        await db.commit()
        assert await cache.get_isochrone(db, 40.7131, -74.0059, 30) is None
        assert (await db.execute(select(IsochroneCache))).first() is None  # lazily deleted


async def test_cleanup_deletes_only_old_unselected_suggestions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cleanup, "AsyncSessionLocal", AsyncSessionLocal)
    user = await make_user()
    old = datetime.now(UTC) - timedelta(days=31)
    async with AsyncSessionLocal() as db:
        trip = Trip(
            user_id=user.id, title="t", mode="radius", start_address="a",
            start_lat=1, start_lng=1, max_drive_minutes=30,
        )  # fmt: skip
        db.add(trip)
        await db.flush()

        def rs(selected: bool, created_at: datetime) -> RadiusSuggestion:
            return RadiusSuggestion(
                trip_id=trip.id, place_id=str(uuid.uuid4()), name="n", address="a", lat=1,
                lng=1, category="park", drive_seconds_from_start=1,
                distance_meters_from_start=1, selected=selected, created_at=created_at,
            )  # fmt: skip

        db.add_all([rs(False, old), rs(True, old), rs(False, datetime.now(UTC))])
        db.add(
            CorridorSuggestion(
                trip_id=trip.id, place_id="p", name="n", address="a", lat=1, lng=1,
                category="park", detour_seconds=1, route_fraction=0.5, selected=False,
                created_at=old,
            )  # fmt: skip
        )
        db.add(DiscoveryCache(cache_key="k", payload={}, created_at=old))
        await db.commit()

    counts = await cleanup.run_cleanup()
    assert counts["radius_suggestions"] == 1
    assert counts["corridor_suggestions"] == 1
    assert counts["discovery_cache"] == 1
    async with AsyncSessionLocal() as db:
        left = (await db.execute(select(RadiusSuggestion))).scalars().all()
        assert sorted(s.selected for s in left) == [False, True]


# --- endpoints -------------------------------------------------------------------------

ROUTE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"  # Google's documented example polyline


async def make_corridor_trip(user: User) -> uuid.UUID:
    async with AsyncSessionLocal() as db:
        trip = Trip(
            user_id=user.id, title="t", mode="point_to_point", start_address="a",
            start_lat=38.5, start_lng=-120.2, end_lat=43.252, end_lng=-126.453,
            total_distance_meters=150_000, total_drive_seconds=6000, route_polyline=ROUTE,
        )  # fmt: skip
        db.add(trip)
        await db.commit()
        return trip.id


def fake_suggestion() -> dict[str, Any]:
    return {
        "place_id": "p1", "name": "Spot", "address": "Somewhere", "lat": 39.0, "lng": -121.0,
        "category": "park", "rating": 4.5, "user_ratings_total": 100, "quality_score": 9.0,
        "detour_seconds": 300, "route_fraction": 0.4,
    }  # fmt: skip


async def test_corridor_discover_budget_503_then_cache_hit_is_free(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    trip_id = await make_corridor_trip(user)
    calls = 0

    def fake_discover(**_: Any) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        return [fake_suggestion()]

    monkeypatch.setattr(corridor_svc, "discover_corridor_suggestions", fake_discover)
    url = f"/trips/{trip_id}/corridor/discover"

    # Budget for exactly one 150 km run (9 Nearby Search calls).
    settings.api_budgets["google.nearby_search"] = {"day": 9, "month": 4500}
    r1 = await client.post(url, headers=auth(user))
    assert r1.status_code == 200, r1.text
    assert r1.json()["cached"] is False

    # Same route again: served from cache, zero Google calls, no budget or quota used.
    r2 = await client.post(url, headers=auth(user))
    assert r2.status_code == 200
    assert r2.json()["cached"] is True and r2.json()["updated_at"]
    assert calls == 1
    assert await total("google.nearby_search") == 9

    # A refresh bypasses the cache and now trips the exhausted budget.
    r3 = await client.post(url + "?refresh=true", headers=auth(user))
    assert r3.status_code == 503
    body = r3.json()
    assert body["code"] == "budget_exhausted" and body["resets_at"]
    assert "retry-after" in r3.headers
    assert calls == 1


async def test_corridor_user_quota_returns_429(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    trip_id = await make_corridor_trip(user)
    monkeypatch.setattr(
        corridor_svc, "discover_corridor_suggestions", lambda **_: [fake_suggestion()]
    )
    settings.user_daily_quotas["corridor_discover"] = 1
    url = f"/trips/{trip_id}/corridor/discover?refresh=true"
    assert (await client.post(url, headers=auth(user))).status_code == 200
    r = await client.post(url, headers=auth(user))
    assert r.status_code == 429
    assert r.json()["code"] == "user_quota"


async def test_second_radius_discover_does_not_call_ors(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    async with AsyncSessionLocal() as db:
        trip = Trip(
            user_id=user.id, title="t", mode="radius", start_address="a", start_lat=40.7131,
            start_lng=-74.0059, max_drive_minutes=30,
        )  # fmt: skip
        db.add(trip)
        await db.commit()
        trip_id = trip.id

    geo = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    ors_calls = 0

    def fake_ors(*_: Any) -> dict[str, Any]:
        nonlocal ors_calls
        ors_calls += 1
        return geo

    sug = {
        "place_id": "p1", "name": "Spot", "address": "x", "lat": 40.8, "lng": -74.0,
        "category": "park", "drive_seconds_from_start": 600, "distance_meters_from_start": 9000,
        "rating": 4.5, "user_ratings_total": 100, "quality_score": 9.0,
    }  # fmt: skip
    monkeypatch.setattr(radius_svc, "fetch_isochrone", fake_ors)
    monkeypatch.setattr(
        radius_svc,
        "discover_suggestions",
        lambda **kw: {"isochrone_geojson": kw["isochrone"], "suggestions": [sug]},
    )
    url = f"/trips/{trip_id}/radius/discover"
    assert (await client.post(url, headers=auth(user))).status_code == 200
    # Refresh re-runs Google discovery but reuses the cached isochrone.
    r = await client.post(url + "?refresh=true", headers=auth(user))
    assert r.status_code == 200 and r.json()["cached"] is False
    # A different category set is a discovery-cache miss but an isochrone-cache hit.
    r = await client.post(url + "?categories=park", headers=auth(user))
    assert r.status_code == 200
    assert ors_calls == 1
    assert await total("ors.isochrone") == 1


async def test_admin_usage_is_restricted_to_admin_emails(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = await make_user("boss@example.com")
    other = await make_user("other@example.com")
    monkeypatch.setattr(settings, "admin_emails", "Boss@example.com")
    async with AsyncSessionLocal() as db:
        await db.execute(
            text(
                "INSERT INTO api_usage_daily (day, sku, units) "
                "VALUES (:d, 'google.nearby_search', 6000)"
            ),
            {"d": budget.utc_today()},
        )
        await db.commit()
    assert (await client.get("/admin/usage", headers=auth(other))).status_code == 403
    assert (await client.get("/admin/usage")).status_code == 401
    r = await client.get("/admin/usage", headers=auth(admin))
    assert r.status_code == 200
    nearby = next(s for s in r.json()["skus"] if s["sku"] == "google.nearby_search")
    assert nearby["month"] == 6000 and nearby["today"] == 6000
    assert nearby["estimated_cost_usd"] == pytest.approx(1000 * 0.032)
