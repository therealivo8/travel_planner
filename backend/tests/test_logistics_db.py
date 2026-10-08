"""Endpoint tests for Phase 16 against a migrated Postgres (see test_budget_db.py)."""

import os
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select, text

from app.api import weather as weather_api
from app.db.session import AsyncSessionLocal
from app.models.logistics import PackingItem
from app.models.trip import ItineraryDay, Trip, Waypoint
from app.services import weather as weather_svc
from tests.helpers import auth, make_user

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DB_TESTS") != "1", reason="set RUN_DB_TESTS=1 with a migrated DATABASE_URL"
)

MILE = 1609.34


async def make_trip(user_id: uuid.UUID, **kw: Any) -> Trip:
    async with AsyncSessionLocal() as db:
        trip = Trip(
            user_id=user_id, title="Road/Trip: 1", mode="point_to_point", start_address="Home",
            start_lat=40.0, start_lng=-74.0, end_address="Away", end_lat=41.0, end_lng=-75.0,
            total_distance_meters=round(500 * MILE), total_drive_seconds=30000, **kw,
        )  # fmt: skip
        db.add(trip)
        await db.commit()
        return trip


async def make_day(trip_id: uuid.UUID, n: int, day_date: Any, n_stops: int) -> uuid.UUID:
    async with AsyncSessionLocal() as db:
        day = ItineraryDay(trip_id=trip_id, day_number=n, date=day_date)
        db.add(day)
        await db.flush()
        base = (await db.execute(select(func.count()).select_from(Waypoint))).scalar_one()
        for i in range(n_stops):
            db.add(
                Waypoint(
                    trip_id=trip_id, position=base + i, address=f"{i} St", lat=40 + i / 100,
                    lng=-74, label=f"S{i}", itinerary_day_id=day.id, day_position=i,
                    distance_meters_from_prev=round(100 * MILE),
                    scheduled_arrival_time=time(17, 0) if i == n_stops - 1 else None,
                    stop_duration_minutes=60, place_id=f"pid{i}",
                )  # fmt: skip
            )
        await db.commit()
        return day.id


async def test_budget_fuel_estimate_expenses_and_ownership(client: httpx.AsyncClient) -> None:
    user, other = await make_user(), await make_user("o@example.com")
    trip = await make_trip(user.id, vehicle_mpg=25, fuel_price_per_unit=4.0, budget_total=300)
    day_id = await make_day(trip.id, 1, None, 2)
    h = auth(user)

    r = await client.get(f"/trips/{trip.id}/budget", headers=h)
    assert r.status_code == 200
    b = r.json()
    assert b["estimated_fuel"] == 80.0 and b["distance_miles"] == 500.0
    assert b["fuel_by_day"][str(day_id)] == 200 / 25 * 4  # two 100-mile legs

    # Changing MPG updates the estimate immediately.
    r = await client.patch(f"/trips/{trip.id}", json={"vehicle_mpg": 50}, headers=h)
    assert r.status_code == 200 and r.json()["vehicle_mpg"] == 50
    assert (await client.get(f"/trips/{trip.id}/budget", headers=h)).json()["estimated_fuel"] == 40
    assert (await client.patch(f"/trips/{trip.id}", json={"vehicle_mpg": None}, headers=h)).status_code == 422

    e1 = await client.post(f"/trips/{trip.id}/expenses", json={"category": "food", "amount": 42.5}, headers=h)
    e2 = await client.post(
        f"/trips/{trip.id}/expenses",
        json={"category": "lodging", "amount": 120, "itinerary_day_id": str(day_id)}, headers=h,
    )  # fmt: skip
    assert e1.status_code == 201 and e2.status_code == 201
    await client.patch(f"/trips/{trip.id}/expenses/{e1.json()['id']}", json={"amount": 50}, headers=h)
    b = (await client.get(f"/trips/{trip.id}/budget", headers=h)).json()
    assert b["spent_by_category"]["food"] == 50 and b["spent_total"] == 170
    assert b["remaining"] == 130
    await client.delete(f"/trips/{trip.id}/expenses/{e2.json()['id']}", headers=h)
    assert (await client.get(f"/trips/{trip.id}/budget", headers=h)).json()["spent_total"] == 50

    # Someone else's trip and someone else's day are rejected.
    assert (await client.get(f"/trips/{trip.id}/budget", headers=auth(other))).status_code == 404
    other_trip = await make_trip(other.id)
    bad = await client.post(
        f"/trips/{other_trip.id}/expenses",
        json={"category": "food", "amount": 1, "itinerary_day_id": str(day_id)},
        headers=auth(other),
    )
    assert bad.status_code == 404


async def test_weather_is_cached_for_three_hours_and_flags_after_dark(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    trip = await make_trip(user.id)
    soon = datetime.now(UTC).date() + timedelta(days=2)
    far = datetime.now(UTC).date() + timedelta(days=40)
    near_day = await make_day(trip.id, 1, soon, 2)
    far_day = await make_day(trip.id, 2, far, 1)
    calls: list[tuple[float, float]] = []

    def fake_fetch(lat: float, lng: float, day: Any) -> dict[str, Any]:
        calls.append((lat, lng))
        return {"hi": 20.0, "lo": 3.0, "precip_pct": 80, "code": 61,
                "sunrise": f"{day}T07:00", "sunset": f"{day}T16:30"}  # fmt: skip

    monkeypatch.setattr(weather_svc, "fetch_day", fake_fetch)
    url = f"/trips/{trip.id}/weather"
    r = await client.get(url, headers=auth(user))
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {str(near_day)}  # beyond 16 days: omitted
    assert str(far_day) not in body
    assert body[str(near_day)]["after_dark"] is True  # last stop 17:00 + 60min > 16:30 sunset
    assert body[str(near_day)]["code"] == 61
    assert len(calls) == 1 and calls[0][0] == pytest.approx(40.01)  # the day's LAST stop

    await client.get(url, headers=auth(user))
    assert len(calls) == 1  # second load within 3h: no Open-Meteo request

    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE weather_cache SET fetched_at = now() - interval '4 hours'"))
        await db.commit()
    await client.get(url, headers=auth(user))
    assert len(calls) == 2  # expired entry is refetched


async def test_weather_outage_hides_chips_without_failing(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    trip = await make_trip(user.id)
    await make_day(trip.id, 1, datetime.now(UTC).date() + timedelta(days=1), 1)

    def boom(*_: Any) -> dict[str, Any]:
        raise RuntimeError("open-meteo down")

    monkeypatch.setattr(weather_svc, "fetch_day", boom)
    r = await client.get(f"/trips/{trip.id}/weather", headers=auth(user))
    assert r.status_code == 200 and r.json() == {}
    assert weather_api.CACHE_TTL == timedelta(hours=3)


async def test_packing_template_twice_does_not_duplicate_and_suggestions(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    trip = await make_trip(user.id)
    h, base = auth(user), f"/trips/{trip.id}/packing"
    first = await client.post(f"{base}/templates/Camping", headers=h)
    count = len(first.json())
    assert count > 0
    again = await client.post(f"{base}/templates/Camping", headers=h)
    assert len(again.json()) == count
    assert (await client.post(f"{base}/templates/Nope", headers=h)).status_code == 404

    item = await client.post(base, json={"label": "Guitar", "category": "Fun"}, headers=h)
    assert item.status_code == 201
    patched = await client.patch(f"{base}/{item.json()['id']}", json={"packed": True}, headers=h)
    assert patched.json()["packed"] is True
    assert (await client.delete(f"{base}/{item.json()['id']}", headers=h)).status_code == 204

    # Cold + rainy forecast suggests both gear templates; Camping is already complete.
    await make_day(trip.id, 1, datetime.now(UTC).date() + timedelta(days=1), 1)
    monkeypatch.setattr(
        weather_svc, "fetch_day",
        lambda lat, lng, d: {"hi": 8.0, "lo": 1.0, "precip_pct": 90, "code": 63,
                             "sunrise": f"{d}T07:00", "sunset": f"{d}T18:00"},
    )  # fmt: skip
    sug = (await client.get(f"{base}/suggestions", headers=h)).json()
    assert {s["template"] for s in sug} == {"Rain gear", "Cold weather"}
    async with AsyncSessionLocal() as db:
        n = (await db.execute(select(func.count()).select_from(PackingItem))).scalar_one()
    assert n == count


async def test_navigation_exports_and_public_share(client: httpx.AsyncClient) -> None:
    user = await make_user()
    trip = await make_trip(user.id)
    d1 = await make_day(trip.id, 1, None, 4)
    d2 = await make_day(trip.id, 2, None, 12)
    h = auth(user)

    nav = (await client.get(f"/trips/{trip.id}/navigation", headers=h)).json()
    assert len(nav["days"][str(d1)]["google"]) == 1
    assert len(nav["days"][str(d2)]["google"]) == 2
    assert len(nav["days"][str(d2)]["apple"]) == 12
    # Day 2 starts from day 1's last stop.
    assert "origin=40.030000,-74.000000" in nav["days"][str(d2)]["google"][0]["url"]

    ics = await client.get(f"/trips/{trip.id}/export/ics", headers=h)
    assert ics.status_code == 200 and ics.headers["content-type"].startswith("text/calendar")
    assert b"BEGIN:VCALENDAR" in ics.content
    assert "Road_Trip_ 1.ics" in ics.headers["content-disposition"]
    gpx = await client.get(f"/trips/{trip.id}/export/gpx", headers=h)
    assert gpx.status_code == 200 and b"<gpx" in gpx.content
    assert (await client.get(f"/trips/{trip.id}/export/gpx", headers=auth(await make_user("x@example.com")))).status_code == 404

    # Public share: not available until sharing is enabled.
    assert (await client.get("/shared/nope/navigation")).status_code == 404
    token = (await client.post(f"/trips/{trip.id}/share", headers=h)).json()["share_token"]
    pub = await client.get(f"/shared/{token}/navigation")
    assert pub.status_code == 200 and len(pub.json()["days"]) == 2
