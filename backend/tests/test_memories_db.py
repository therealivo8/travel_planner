"""Phase 17: check-ins, photos (R2 mocked), recap and My Map. Need a migrated Postgres."""

import os
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import func, select, text

from app.config import settings
from app.core import cleanup
from app.db.session import AsyncSessionLocal
from app.models.memories import PendingObjectDelete, TripPhoto
from app.models.trip import ItineraryDay, Trip, Waypoint
from app.models.user import User
from app.services import storage
from tests.helpers import auth, make_user

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DB_TESTS") != "1", reason="set RUN_DB_TESTS=1 with a migrated DATABASE_URL"
)

POLY = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


@pytest.fixture
def r2(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Fake R2 credentials (presigning is local) and an in-memory 'bucket'."""
    for name, value in {
        "r2_account_id": "acct", "r2_access_key_id": "AKID", "r2_secret_access_key": "secret",
        "r2_bucket": "bucket", "r2_public_base_url": "https://photos.example.com",
    }.items():  # fmt: skip
        monkeypatch.setattr(settings, name, value)
    storage._client.cache_clear()
    bucket: dict[str, int] = {}
    deleted: list[str] = []
    monkeypatch.setattr(storage, "object_size", lambda key: bucket.get(key))

    def fake_delete(keys: list[str]) -> None:
        deleted.extend(keys)

    monkeypatch.setattr(storage, "delete_objects", fake_delete)
    return {"bucket": bucket, "deleted": deleted}


async def make_trip(user: User, **kw: Any) -> Trip:
    async with AsyncSessionLocal() as db:
        trip = Trip(
            user_id=user.id, title="Trip", mode="point_to_point", start_address="A", start_lat=40,
            start_lng=-74, end_address="B", end_lat=41, end_lng=-75, route_polyline=POLY,
            total_distance_meters=500_000, total_drive_seconds=20000, **kw,
        )  # fmt: skip
        db.add(trip)
        await db.commit()
        return trip


async def add_day(trip: Trip, n: int, day_date: date | None, stops: int) -> tuple[uuid.UUID, list[uuid.UUID]]:
    async with AsyncSessionLocal() as db:
        day = ItineraryDay(trip_id=trip.id, day_number=n, date=day_date, title=f"Day {n}")
        db.add(day)
        await db.flush()
        base = (await db.execute(select(func.count()).select_from(Waypoint).where(Waypoint.trip_id == trip.id))).scalar_one()
        wps = [
            Waypoint(trip_id=trip.id, position=base + i, address=f"{i} St", lat=40 + i / 10,
                     lng=-74, label=f"Stop {n}.{i}", itinerary_day_id=day.id, day_position=i)
            for i in range(stops)
        ]  # fmt: skip
        db.add_all(wps)
        await db.commit()
        return day.id, [w.id for w in wps]


async def upload(client: httpx.AsyncClient, user: User, trip: Trip, r2: dict[str, Any], size: int = 300_000, **links: Any) -> httpx.Response:
    h = auth(user)
    req = {"content_type": "image/webp", "bytes": size, "width": 1600, "height": 1000, **links}
    approved = await client.post(f"/trips/{trip.id}/photos/upload-url", json=req, headers=h)
    if approved.status_code != 200:
        return approved
    key = approved.json()["object_key"]
    r2["bucket"][key] = size  # the browser's direct PUT to R2
    return await client.post(
        f"/trips/{trip.id}/photos", json={"object_key": key, "width": 1600, "height": 1000, "bytes": size, **links}, headers=h
    )


async def test_photos_unavailable_without_r2(client: httpx.AsyncClient) -> None:
    user = await make_user()
    trip = await make_trip(user)
    r = await client.post(
        f"/trips/{trip.id}/photos/upload-url",
        json={"content_type": "image/webp", "bytes": 1000, "width": 10, "height": 10},
        headers=auth(user),
    )
    assert r.status_code == 503 and "isn't set up" in r.json()["detail"]
    assert (await client.get(f"/trips/{trip.id}/photos", headers=auth(user))).json() == []


async def test_upload_url_is_presigned_direct_to_r2_and_limits_apply(
    client: httpx.AsyncClient, r2: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await make_user()
    trip = await make_trip(user)
    h = auth(user)
    base = {"content_type": "image/webp", "bytes": 250_000, "width": 1600, "height": 900}

    ok = await client.post(f"/trips/{trip.id}/photos/upload-url", json=base, headers=h)
    assert ok.status_code == 200
    body = ok.json()
    url = urlparse(body["upload_url"])
    assert url.netloc == "acct.r2.cloudflarestorage.com"  # straight to R2, not through the API
    assert body["object_key"].startswith(f"trips/{trip.id}/") and body["object_key"].endswith(".webp")
    q = parse_qs(url.query)
    assert "content-length" in q["X-Amz-SignedHeaders"][0]  # the approved size is part of the signature
    assert body["headers"] == {"Content-Type": "image/webp"}

    too_big = await client.post(f"/trips/{trip.id}/photos/upload-url", json={**base, "bytes": 6 * 1024 * 1024}, headers=h)
    assert too_big.status_code == 413 and "5 MB" in too_big.json()["detail"]
    bad_type = await client.post(f"/trips/{trip.id}/photos/upload-url", json={**base, "content_type": "image/gif"}, headers=h)
    assert bad_type.status_code == 422
    assert (await client.post(f"/trips/{(await make_trip(await make_user('o@example.com'))).id}/photos/upload-url", json=base, headers=h)).status_code == 404

    # The 51st photo is rejected with a clear message (limit lowered to keep the test fast).
    monkeypatch.setattr(settings, "photos_per_trip", 2)
    assert (await upload(client, user, trip, r2)).status_code == 201
    assert (await upload(client, user, trip, r2)).status_code == 201
    third = await upload(client, user, trip, r2)
    assert third.status_code == 409 and "2-photo limit" in third.json()["detail"]
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(User.storage_bytes).where(User.id == user.id))).scalar_one() == 600_000

    monkeypatch.setattr(settings, "photos_per_trip", 50)
    monkeypatch.setattr(settings, "photos_per_user", 2)
    per_user = await upload(client, user, await make_trip(user), r2)
    assert per_user.status_code == 409 and "across all trips" in per_user.json()["detail"]


async def test_confirm_checks_the_object_really_exists_and_belongs_to_the_trip(
    client: httpx.AsyncClient, r2: dict[str, Any]
) -> None:
    user = await make_user()
    trip = await make_trip(user)
    h = auth(user)
    body = {"width": 10, "height": 10, "bytes": 1000}
    missing = await client.post(f"/trips/{trip.id}/photos", json={**body, "object_key": f"trips/{trip.id}/nope.webp"}, headers=h)
    assert missing.status_code == 400
    foreign = await client.post(f"/trips/{trip.id}/photos", json={**body, "object_key": f"trips/{uuid.uuid4()}/x.webp"}, headers=h)
    assert foreign.status_code == 400
    r2["bucket"][f"trips/{trip.id}/a.webp"] = 999  # wrong size uploaded
    wrong = await client.post(f"/trips/{trip.id}/photos", json={**body, "object_key": f"trips/{trip.id}/a.webp"}, headers=h)
    assert wrong.status_code == 400


async def test_photo_urls_private_vs_public_and_deletes_are_queued(
    client: httpx.AsyncClient, r2: dict[str, Any]
) -> None:
    user = await make_user()
    trip = await make_trip(user)
    h = auth(user)
    created = (await upload(client, user, trip, r2)).json()
    assert "X-Amz-Signature" in created["url"]  # private trip: short-lived presigned GET

    await client.patch(f"/trips/{trip.id}", json={"share_recap": True}, headers=h)
    listed = (await client.get(f"/trips/{trip.id}/photos", headers=h)).json()
    assert listed[0]["url"].startswith("https://photos.example.com/trips/")  # shared recap: public domain

    cap = await client.patch(f"/trips/{trip.id}/photos/{created['id']}", json={"caption": "Sunset"}, headers=h)
    assert cap.json()["caption"] == "Sunset"

    assert (await client.delete(f"/trips/{trip.id}/photos/{created['id']}", headers=h)).status_code == 204
    async with AsyncSessionLocal() as db:
        queued = (await db.execute(select(PendingObjectDelete.object_key))).scalars().all()
        assert len(queued) == 1 and queued[0].startswith(f"trips/{trip.id}/")
        assert (await db.execute(select(User.storage_bytes).where(User.id == user.id))).scalar_one() == 0
    assert r2["deleted"] == []  # nothing touched R2 during the user's request


async def test_trip_and_account_delete_queue_objects_and_cleanup_empties_queue(
    client: httpx.AsyncClient, r2: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cleanup, "AsyncSessionLocal", AsyncSessionLocal)
    user = await make_user()
    t1, t2 = await make_trip(user), await make_trip(user)
    await upload(client, user, t1, r2)
    await upload(client, user, t1, r2)
    await upload(client, user, t2, r2)
    h = auth(user)

    assert (await client.delete(f"/trips/{t1.id}", headers=h)).status_code == 204
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(PendingObjectDelete))).scalar_one() == 2
        assert (await db.execute(select(User.storage_bytes).where(User.id == user.id))).scalar_one() == 300_000

    # R2 is down: the queue keeps its rows and counts the attempt.
    def boom(keys: list[str]) -> None:
        raise RuntimeError("R2 unavailable")

    monkeypatch.setattr(storage, "delete_objects", boom)
    assert await cleanup.process_pending_object_deletes() == 0
    async with AsyncSessionLocal() as db:
        attempts = (await db.execute(select(PendingObjectDelete.attempts))).scalars().all()
        assert attempts == [1, 1]

    # R2 recovers: one cleanup cycle removes the objects and empties the queue.
    monkeypatch.setattr(storage, "delete_objects", lambda keys: r2["deleted"].extend(keys))
    assert await cleanup.process_pending_object_deletes() == 2
    assert len(r2["deleted"]) == 2 and all(k.startswith(f"trips/{t1.id}/") for k in r2["deleted"])

    # Deleting the account queues what's left.
    from app.core.security import hash_password

    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE users SET hashed_password = :h WHERE id = :i"), {"h": hash_password("pw"), "i": user.id})
        await db.commit()
    gone = await client.request("DELETE", "/auth/me", json={"password": "pw"}, headers=h)
    assert gone.status_code == 204
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count()).select_from(TripPhoto))).scalar_one() == 0
        queued = (await db.execute(select(PendingObjectDelete.object_key))).scalars().all()
        assert len(queued) == 1 and queued[0].startswith(f"trips/{t2.id}/")


async def test_check_in_is_idempotent_and_supports_replay(client: httpx.AsyncClient) -> None:
    user = await make_user()
    trip = await make_trip(user)
    _, wps = await add_day(trip, 1, None, 2)
    h = auth(user)
    url = f"/trips/{trip.id}/waypoints/{wps[0]}/check-in"

    earlier = (datetime.now(UTC) - timedelta(hours=2)).replace(microsecond=0)
    r = await client.post(url, json={"action": "arrived", "at": earlier.isoformat()}, headers=h)
    assert r.status_code == 200 and datetime.fromisoformat(r.json()["visited_at"]) == earlier
    again = await client.post(url, json={"action": "arrived", "at": earlier.isoformat()}, headers=h)
    assert again.json()["visited_at"] == r.json()["visited_at"]  # replaying changes nothing

    future = await client.post(url, json={"action": "arrived", "at": (datetime.now(UTC) + timedelta(days=1)).isoformat()}, headers=h)
    assert datetime.fromisoformat(future.json()["visited_at"]) <= datetime.now(UTC)  # never the future

    skipped = (await client.post(url, json={"action": "skipped"}, headers=h)).json()
    assert skipped["skipped"] is True and skipped["visited_at"] is None
    undone = (await client.post(url, json={"action": "undo"}, headers=h)).json()
    assert undone["skipped"] is False and undone["visited_at"] is None
    other = await client.post(f"/trips/{(await make_trip(await make_user('x@example.com'))).id}/waypoints/{wps[0]}/check-in", json={"action": "arrived"}, headers=h)
    assert other.status_code == 404

    itin = (await client.get(f"/trips/{trip.id}/itinerary", headers=h)).json()
    assert "visited_at" in itin["days"][0]["waypoints"][0]


async def test_trip_phase_uses_trip_timezone_and_never_changes_status(client: httpx.AsyncClient) -> None:
    user = await make_user()
    tz = "Pacific/Auckland"  # far ahead of UTC, so 'today' can differ from the UTC date
    trip = await make_trip(user, timezone=tz)
    today = datetime.now(ZoneInfo(tz)).date()
    h = auth(user)
    await add_day(trip, 1, today - timedelta(days=1), 1)
    await add_day(trip, 2, today + timedelta(days=1), 1)
    got = (await client.get(f"/trips/{trip.id}", headers=h)).json()
    assert got["in_progress"] is True and got["ended"] is False

    past = await make_trip(user)
    await add_day(past, 1, date.today() - timedelta(days=10), 1)
    got = (await client.get(f"/trips/{past.id}", headers=h)).json()
    assert got["in_progress"] is False and got["ended"] is True and got["status"] == "draft"

    await client.patch(f"/trips/{past.id}", json={"status": "completed"}, headers=h)
    got = (await client.get(f"/trips/{past.id}", headers=h)).json()
    assert got["ended"] is False


async def test_recap_stats_and_public_share(client: httpx.AsyncClient, r2: dict[str, Any]) -> None:
    user = await make_user()
    trip = await make_trip(user)
    day, wps = await add_day(trip, 1, date.today(), 3)
    h = auth(user)
    await client.post(f"/trips/{trip.id}/waypoints/{wps[0]}/check-in", json={"action": "arrived"}, headers=h)
    await client.post(f"/trips/{trip.id}/waypoints/{wps[1]}/check-in", json={"action": "skipped"}, headers=h)
    await client.patch(f"/trips/{trip.id}/waypoints/{wps[0]}", json={"notes": "Great diner"}, headers=h)
    await upload(client, user, trip, r2, waypoint_id=str(wps[0]))
    await upload(client, user, trip, r2, itinerary_day_id=str(day))
    await client.post(f"/trips/{trip.id}/expenses", json={"category": "food", "amount": 40}, headers=h)

    recap = (await client.get(f"/trips/{trip.id}/recap", headers=h)).json()
    assert (recap["stops_planned"], recap["stops_visited"], recap["stops_skipped"]) == (3, 1, 1)
    assert recap["photo_count"] == 2 and recap["spent_total"] == 40 and recap["spent_by_category"]["food"] == 40
    stop = recap["days"][0]["stops"][0]
    assert stop["notes"] == "Great diner" and len(stop["photos"]) == 1 and len(recap["days"][0]["photos"]) == 1

    # Sharing the trip alone does not publish the recap; opting in does, without the money.
    token = (await client.post(f"/trips/{trip.id}/share", headers=h)).json()["share_token"]
    assert (await client.get(f"/shared/{token}")).json()["recap"] is None
    await client.patch(f"/trips/{trip.id}", json={"share_recap": True}, headers=h)
    pub = (await client.get(f"/shared/{token}")).json()["recap"]
    assert pub["stops_visited"] == 1 and pub["spent_total"] is None and pub["spent_by_category"] is None
    assert pub["days"][0]["stops"][0]["photos"][0]["url"].startswith("https://photos.example.com/")


async def test_my_map_lists_routes_and_visited_stops(client: httpx.AsyncClient) -> None:
    user = await make_user()
    h = auth(user)
    a = await make_trip(user, start_date=date(2025, 6, 1))
    async with AsyncSessionLocal() as db:
        db.add(Trip(user_id=user.id, title="Long one", mode="point_to_point", start_address="A", start_lat=1, start_lng=1,
                    end_address="B", end_lat=2, end_lng=2, route_polyline=POLY, total_distance_meters=900_000,
                    start_date=date(2026, 6, 1)))  # fmt: skip
        db.add(Trip(user_id=user.id, title="No route", mode="radius", start_address="A", start_lat=1, start_lng=1,
                    max_drive_minutes=30))  # fmt: skip
        await db.commit()
    _, wps = await add_day(a, 1, None, 2)
    await client.post(f"/trips/{a.id}/waypoints/{wps[0]}/check-in", json={"action": "arrived"}, headers=h)

    data = (await client.get("/map", headers=h)).json()
    assert data["years"] == [2026, 2025]
    assert {t["title"] for t in data["trips"]} == {"Trip", "Long one"}  # the route-less trip is left out
    assert data["stats"]["trips"] == 2 and data["stats"]["total_distance_meters"] == 1_400_000
    assert data["stats"]["longest_trip_title"] == "Long one" and data["stats"]["stops_visited"] == 1
    mine = next(t for t in data["trips"] if t["title"] == "Trip")
    assert len(mine["visited_stops"]) == 1 and mine["stops_count"] == 2

    only = (await client.get("/map?year=2025", headers=h)).json()
    assert [t["title"] for t in only["trips"]] == ["Trip"] and only["years"] == [2026, 2025]

    # The example trip (from registration) never shows up on the map.
    reg = await client.post("/auth/register", json={"email": "fresh@example.com", "password": "password123"})
    fresh = (await client.get("/map", headers={"Authorization": f"Bearer {reg.json()['access_token']}"})).json()
    assert fresh["trips"] == [] and fresh["stats"]["trips"] == 0
