from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import budget
from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.budget import ApiUsageDaily

router = APIRouter(tags=["usage"])

DB = Annotated[AsyncSession, Depends(get_db)]

# Quotas surfaced next to the Discover buttons.
DISCOVERY_ACTIONS = ["radius_discover", "corridor_discover"]


class MyQuotaOut(BaseModel):
    remaining: dict[str, int]
    limits: dict[str, int]
    resets_at: str


@router.get("/usage/me", response_model=MyQuotaOut)
async def my_quota(current_user: CurrentUser, db: DB) -> MyQuotaOut:
    remaining = await budget.remaining_user_actions(db, current_user.id, DISCOVERY_ACTIONS)
    return MyQuotaOut(
        remaining=remaining,
        limits={a: settings.user_daily_quotas[a] for a in remaining},
        resets_at=budget.next_utc_midnight().isoformat(),
    )


class SkuUsageOut(BaseModel):
    sku: str
    today: int
    month: int
    day_budget: int | None
    month_budget: int | None
    free_allowance: int | None
    estimated_cost_usd: float


class UsageOut(BaseModel):
    month_start: str
    skus: list[SkuUsageOut]
    estimated_total_cost_usd: float


@router.get("/admin/usage", response_model=UsageOut)
async def admin_usage(current_user: CurrentUser, db: DB) -> UsageOut:
    # No role system yet: admins are listed by email in ADMIN_EMAILS.
    if current_user.email.lower() not in settings.admin_emails_list:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    today = budget.utc_today()
    month_start = today.replace(day=1)
    rows = (
        await db.execute(select(ApiUsageDaily).where(ApiUsageDaily.day >= month_start))
    ).scalars()
    month_units: dict[str, int] = {}
    today_units: dict[str, int] = {}
    for r in rows:
        month_units[r.sku] = month_units.get(r.sku, 0) + r.units
        if r.day == today:
            today_units[r.sku] = r.units

    skus: list[SkuUsageOut] = []
    for sku in sorted(set(settings.api_budgets) | set(month_units)):
        limits = settings.api_budgets.get(sku, {})
        free = settings.api_free_allowance.get(sku)
        price = settings.api_unit_price_usd.get(sku, 0.0)
        month = month_units.get(sku, 0)
        cost = max(0, month - (free or 0)) * price
        skus.append(
            SkuUsageOut(
                sku=sku,
                today=today_units.get(sku, 0),
                month=month,
                day_budget=limits.get("day"),
                month_budget=limits.get("month"),
                free_allowance=free,
                estimated_cost_usd=round(cost, 2),
            )
        )
    return UsageOut(
        month_start=month_start.isoformat(),
        skus=skus,
        estimated_total_cost_usd=round(sum(s.estimated_cost_usd for s in skus), 2),
    )
