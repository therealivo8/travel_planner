"""Hard daily/monthly budgets per paid upstream SKU, plus per-user daily quotas.

Everything lives in Postgres so counters survive deploys and are shared across
replicas. Reservation happens in the API layer *before* the upstream call, using an
up-front estimate, so the services stay free of database code and a discovery run never
gets halfway through and then fails on the budget. Counting a call that later fails is
deliberate: over-counting is safer than under-counting.

Both `reserve` and `consume_user_action` are a single upsert round trip
(`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), which is atomic under concurrent
requests: a second transaction blocks on the row lock and then sees the first's total.
On refusal they roll the session back, undoing the increment — callers must therefore
call them before making other uncommitted changes, and `db.commit()` afterwards to
persist the counters before starting a slow upstream call.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import upstream_log

# SKU names used across the app.
NEARBY_SEARCH = "google.nearby_search"
DISTANCE_MATRIX = "google.distance_matrix_element"
DIRECTIONS = "google.directions"
GEOCODE = "google.geocode"
ORS_ISOCHRONE = "ors.isochrone"

WARN_FRACTION = 0.8


class BudgetExceeded(Exception):  # noqa: N818
    def __init__(self, sku: str, scope: str, resets_at: datetime) -> None:
        super().__init__(f"{sku} {scope} budget exhausted")
        self.sku = sku
        self.scope = scope
        self.resets_at = resets_at


class UserQuotaExceeded(Exception):  # noqa: N818
    def __init__(self, action: str, limit: int, resets_at: datetime) -> None:
        super().__init__(f"daily quota for {action} exhausted")
        self.action = action
        self.limit = limit
        self.resets_at = resets_at


def utc_today() -> date:
    return datetime.now(UTC).date()


def next_utc_midnight(today: date | None = None) -> datetime:
    today = today or utc_today()
    return datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=UTC)


def next_month_start(today: date | None = None) -> datetime:
    today = today or utc_today()
    first = today.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return datetime.combine(nxt, datetime.min.time(), tzinfo=UTC)


_RESERVE_SQL = text(
    """
    WITH up AS (
        INSERT INTO api_usage_daily (day, sku, units)
        VALUES (:day, :sku, :units)
        ON CONFLICT (day, sku) DO UPDATE SET units = api_usage_daily.units + EXCLUDED.units
        RETURNING units
    )
    SELECT
        up.units AS day_units,
        up.units + COALESCE((
            SELECT SUM(units) FROM api_usage_daily
            WHERE sku = :sku AND day >= :month_start AND day < :day
        ), 0) AS month_units
    FROM up
    """
)

# Skus already warned about today, so the Sentry warning fires at most once per SKU per
# day per process. (Per process, not global: a deploy mid-day may re-warn once.)
_warned: set[tuple[date, str]] = set()


async def reserve(db: AsyncSession, sku: str, units: int) -> None:
    """Count `units` of `sku` against today's and this month's budget.

    Raises BudgetExceeded (after rolling back the increment) if either would be exceeded.
    SKUs without a configured budget are counted but never refused.
    """
    if units <= 0:
        return
    today = utc_today()
    row = (
        await db.execute(
            _RESERVE_SQL,
            {"day": today, "sku": sku, "units": units, "month_start": today.replace(day=1)},
        )
    ).one()
    day_units, month_units = int(row.day_units), int(row.month_units)

    limits = settings.api_budgets.get(sku)
    if limits is None:
        return
    day_cap, month_cap = limits.get("day"), limits.get("month")
    if day_cap is not None and day_units > day_cap:
        await db.rollback()
        raise BudgetExceeded(sku, "day", next_utc_midnight(today))
    if month_cap is not None and month_units > month_cap:
        await db.rollback()
        raise BudgetExceeded(sku, "month", next_month_start(today))

    if month_cap and month_units >= WARN_FRACTION * month_cap and (today, sku) not in _warned:
        _warned.add((today, sku))
        upstream_log.log_budget_warning(sku, month_units, month_cap)


async def reserve_many(db: AsyncSession, units_by_sku: dict[str, int]) -> None:
    """Reserve several SKUs in one transaction: either all are counted or none are."""
    for sku, units in units_by_sku.items():
        await reserve(db, sku, units)


_ACTION_SQL = text(
    """
    INSERT INTO user_action_daily (day, user_id, action, count)
    VALUES (:day, :user_id, :action, 1)
    ON CONFLICT (day, user_id, action) DO UPDATE SET count = user_action_daily.count + 1
    RETURNING count
    """
)


async def consume_user_action(db: AsyncSession, user_id: uuid.UUID, action: str) -> int:
    """Count one `action` for `user_id` today. Returns how many remain afterwards.

    Raises UserQuotaExceeded (after rolling back the increment) once the daily cap is hit.
    """
    limit = settings.user_daily_quotas.get(action)
    today = utc_today()
    count = (
        await db.execute(_ACTION_SQL, {"day": today, "user_id": user_id, "action": action})
    ).scalar_one()
    if limit is None:
        return 10**6
    if count > limit:
        await db.rollback()
        raise UserQuotaExceeded(action, limit, next_utc_midnight(today))
    return limit - int(count)


async def remaining_user_actions(
    db: AsyncSession, user_id: uuid.UUID, actions: list[str]
) -> dict[str, int]:
    result = await db.execute(
        text(
            "SELECT action, count AS used FROM user_action_daily "
            "WHERE day = :day AND user_id = :user_id AND action = ANY(:actions)"
        ),
        {"day": utc_today(), "user_id": user_id, "actions": actions},
    )
    used = {r.action: int(r.used) for r in result}
    return {
        a: max(0, settings.user_daily_quotas[a] - used.get(a, 0))
        for a in actions
        if a in settings.user_daily_quotas
    }


async def charge(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    action: str | None,
    units_by_sku: dict[str, int],
) -> None:
    """Gate one user-triggered action: count it against the user's daily quota (if `action`
    is given) and reserve its upstream units, atomically, then commit the counters.

    Raises UserQuotaExceeded / BudgetExceeded with nothing counted. Committing here
    persists the counters before the (possibly slow) upstream call starts.
    """
    if action is not None and user_id is not None:
        await consume_user_action(db, user_id, action)
    await reserve_many(db, units_by_sku)
    await db.commit()
