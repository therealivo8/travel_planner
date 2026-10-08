import os
from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from app.config import settings
from app.core import budget

DB_TESTS = os.environ.get("RUN_DB_TESTS") == "1"


@pytest_asyncio.fixture(autouse=True)
async def clean_db(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    if not DB_TESTS:
        yield
        return
    from app.core.limiter import limiter
    from app.db.session import AsyncSessionLocal

    limiter.reset()  # slowapi counters are per-process; tests share one IP
    async with AsyncSessionLocal() as db:
        await db.execute(
            text(
                "TRUNCATE api_usage_daily, user_action_daily, isochrone_cache, "
                "discovery_cache, weather_cache, password_reset_tokens, pending_object_deletes, users CASCADE"
            )
        )
        await db.commit()
    budget._warned.clear()
    monkeypatch.setattr(settings, "api_budgets", dict(settings.api_budgets))
    monkeypatch.setattr(settings, "user_daily_quotas", dict(settings.user_daily_quotas))
    yield


@pytest_asyncio.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
