"""A non-Latin trip title must not crash downloads (needs a migrated Postgres)."""

import os

import httpx
import pytest
from sqlalchemy import update

from app.db.session import AsyncSessionLocal
from app.models.trip import Trip
from tests.helpers import auth, make_user
from tests.test_logistics_db import make_trip

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DB_TESTS") != "1", reason="needs a migrated Postgres (RUN_DB_TESTS=1)"
)


@pytest.mark.parametrize("fmt", ["ics", "gpx"])
async def test_non_latin_title_downloads(client: httpx.AsyncClient, fmt: str) -> None:
    user = await make_user()
    trip = await make_trip(user.id)
    async with AsyncSessionLocal() as db:
        await db.execute(update(Trip).where(Trip.id == trip.id).values(title="Tokyo 東京 trip"))
        await db.commit()
    resp = await client.get(f"/trips/{trip.id}/export/{fmt}", headers=auth(user))
    assert resp.status_code == 200
    disposition = resp.headers["content-disposition"]
    assert f'filename="Tokyo __ trip.{fmt}"' in disposition
    assert "filename*=UTF-8''" in disposition
