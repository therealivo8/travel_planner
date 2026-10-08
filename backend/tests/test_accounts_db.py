"""Phase 15 account, reset-password and example-trip tests (need a migrated Postgres)."""

import logging
import os
import re
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select, text, update

from app.core.security import create_refresh_token
from app.db.session import AsyncSessionLocal
from app.models.trip import Trip, Waypoint
from app.models.user import PasswordResetToken, User

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DB_TESTS") != "1", reason="set RUN_DB_TESTS=1 with a migrated DATABASE_URL"
)

PW = "correct horse battery"


async def register(client: httpx.AsyncClient, email: str = "new@example.com") -> httpx.Response:
    return await client.post("/auth/register", json={"email": email, "password": PW})


def bearer(resp: httpx.Response) -> dict[str, str]:
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_registration_creates_example_trip_without_upstream_calls(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import places, radius, routes

    def forbidden(*_: object, **__: object) -> None:
        raise AssertionError("registration must not call Google or ORS")

    monkeypatch.setattr(places, "get_client", forbidden)
    monkeypatch.setattr(radius, "fetch_isochrone", forbidden)
    monkeypatch.setattr(routes, "calculate_route", forbidden)

    r = await register(client)
    assert r.status_code == 201
    trips = (await client.get("/trips", headers=bearer(r))).json()["items"]
    assert len(trips) == 1 and trips[0]["is_example"] is True
    trip = (await client.get(f"/trips/{trips[0]['id']}", headers=bearer(r))).json()
    assert len(trip["waypoints"]) == 7 and trip["route_polyline"]
    assert all(w["place_id"] is None for w in trip["waypoints"])  # no Google-owned ids
    days = (await client.get(f"/trips/{trip['id']}/itinerary", headers=bearer(r))).json()["days"]
    assert [len(d["waypoints"]) for d in days] == [3, 2, 2]

    # Duplicating the example keeps its route and is not itself an example.
    dup = await client.post(f"/trips/{trip['id']}/duplicate", headers=bearer(r))
    assert dup.status_code == 201
    assert dup.json()["is_example"] is False and dup.json()["route_polyline"]


async def test_profile_preferences_and_default_stop_minutes(client: httpx.AsyncClient) -> None:
    r = await register(client)
    h = bearer(r)
    me = (await client.get("/auth/me", headers=h)).json()
    assert me["units"] == "imperial" and me["default_stop_minutes"] == 60

    upd = await client.patch(
        "/auth/me",
        json={"display_name": "Sam", "units": "metric", "default_stop_minutes": 45,
              "home_address": "1 Main St", "home_lat": 40.1, "home_lng": -74.2},
        headers=h,
    )  # fmt: skip
    assert upd.status_code == 200
    assert upd.json()["units"] == "metric" and upd.json()["home_lat"] == 40.1
    # Address and coordinates travel together.
    assert (await client.patch("/auth/me", json={"home_address": None}, headers=h)).status_code == 422
    assert (await client.patch("/auth/me", json={"units": None}, headers=h)).status_code == 422
    cleared = await client.patch(
        "/auth/me", json={"home_address": None, "home_lat": None, "home_lng": None}, headers=h
    )
    assert cleared.json()["home_address"] is None

    trip = (await client.get("/trips", headers=h)).json()["items"][0]["id"]
    wp = await client.post(
        f"/trips/{trip}/waypoints", json={"address": "x", "lat": 1, "lng": 2}, headers=h
    )
    assert wp.json()["stop_duration_minutes"] == 45


async def test_change_password_revokes_other_sessions(client: httpx.AsyncClient) -> None:
    r = await register(client)
    h = bearer(r)
    other_session = create_refresh_token(r.json()["access_token"] and (await client.get("/auth/me", headers=h)).json()["id"])
    time.sleep(1.1)  # iat has one-second resolution

    bad = await client.post(
        "/auth/change-password", json={"current_password": "nope", "new_password": "another pw 123"}, headers=h
    )
    assert bad.status_code == 400
    ok = await client.post(
        "/auth/change-password", json={"current_password": PW, "new_password": "another pw 123"}, headers=h
    )
    assert ok.status_code == 200

    # The caller keeps a working session; the old browser's refresh token and access token don't.
    assert (await client.get("/auth/me", headers=bearer(ok))).status_code == 200
    assert (await client.get("/auth/me", headers=h)).status_code == 401
    stale = await client.post("/auth/refresh", cookies={"refresh_token": other_session})
    assert stale.status_code == 401
    fresh = await client.post("/auth/refresh", cookies={"refresh_token": ok.cookies["refresh_token"]})
    assert fresh.status_code == 200
    login = await client.post("/auth/login", json={"email": "new@example.com", "password": "another pw 123"})
    assert login.status_code == 200


async def test_forgot_and_reset_password_end_to_end(
    client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    await register(client)
    caplog.set_level(logging.WARNING)

    # 202 for a known and an unknown email alike.
    known = await client.post("/auth/forgot-password", json={"email": "new@example.com"})
    unknown = await client.post("/auth/forgot-password", json={"email": "ghost@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()

    # No Resend key locally: the link is logged to the console.
    link = re.search(r"reset-password\?token=([\w-]+)", caplog.text)
    assert link, caplog.text
    token = link.group(1)
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(PasswordResetToken))).scalars().all()
        assert len(rows) == 1 and rows[0].token_hash != token and len(rows[0].token_hash) == 64

    new = "brand new password"
    assert (await client.post("/auth/reset-password", json={"token": token, "new_password": new})).status_code == 204
    # Single use.
    again = await client.post("/auth/reset-password", json={"token": token, "new_password": "yet another one"})
    assert again.status_code == 400
    assert (await client.post("/auth/login", json={"email": "new@example.com", "password": new})).status_code == 200
    assert (await client.post("/auth/login", json={"email": "new@example.com", "password": PW})).status_code == 401


async def test_expired_reset_token_and_per_email_cap(client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture) -> None:
    await register(client)
    caplog.set_level(logging.WARNING)
    await client.post("/auth/forgot-password", json={"email": "new@example.com"})
    token = re.search(r"token=([\w-]+)", caplog.text).group(1)  # type: ignore[union-attr]
    async with AsyncSessionLocal() as db:
        await db.execute(update(PasswordResetToken).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        await db.commit()
    expired = await client.post("/auth/reset-password", json={"token": token, "new_password": "whatever123"})
    assert expired.status_code == 400

    # Past 3 tokens in an hour, further requests still return 202 but mint nothing.
    async with AsyncSessionLocal() as db:
        uid = (await db.execute(select(User.id))).scalar_one()
        for i in range(2):
            db.add(PasswordResetToken(token_hash=f"{i}" * 64, user_id=uid,
                                      expires_at=datetime.now(UTC) + timedelta(hours=1)))  # fmt: skip
        await db.commit()
    r = await client.post("/auth/forgot-password", json={"email": "new@example.com"})
    assert r.status_code == 202
    async with AsyncSessionLocal() as db:
        count = (await db.execute(select(func.count()).select_from(PasswordResetToken))).scalar_one()
    assert count == 3


async def test_export_excludes_secrets_and_google_content(client: httpx.AsyncClient) -> None:
    r = await register(client)
    h = bearer(r)
    res = await client.get("/auth/me/export", headers=h)
    assert res.status_code == 200 and "attachment" in res.headers["content-disposition"]
    data = res.json()
    assert data["user"]["email"] == "new@example.com" and "hashed_password" not in data["user"]
    trip = data["trips"][0]
    assert len(trip["waypoints"]) == 7 and len(trip["itinerary_days"]) == 3
    assert "route_raw_response" not in trip and "share_token" not in trip
    assert "radius_suggestions" not in trip and "corridor_suggestions" not in trip


async def test_delete_account_removes_everything(client: httpx.AsyncClient) -> None:
    r = await register(client)
    h = bearer(r)
    await client.post("/auth/forgot-password", json={"email": "new@example.com"})
    assert (await client.request("DELETE", "/auth/me", json={"password": "wrong"}, headers=h)).status_code == 400
    gone = await client.request("DELETE", "/auth/me", json={"password": PW}, headers=h)
    assert gone.status_code == 204
    assert (await client.get("/auth/me", headers=h)).status_code == 401
    async with AsyncSessionLocal() as db:
        for table in ("users", "trips", "waypoints", "itinerary_days", "password_reset_tokens"):
            n = (await db.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()  # noqa: S608
            assert n == 0, table
    assert (await client.post("/auth/login", json={"email": "new@example.com", "password": PW})).status_code == 401
    assert Trip and Waypoint  # models imported for metadata
