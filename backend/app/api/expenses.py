import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.core.trips import get_owned_trip
from app.db.session import get_db
from app.models.logistics import EXPENSE_CATEGORIES, TripExpense
from app.models.trip import ItineraryDay, Trip
from app.schemas.logistics import BudgetOut, ExpenseCreate, ExpenseOut, ExpenseUpdate
from app.services.costs import METERS_PER_MILE, fuel_estimate

router = APIRouter(prefix="/trips/{trip_id}", tags=["expenses"])

DB = Annotated[AsyncSession, Depends(get_db)]


async def _check_day(db: AsyncSession, trip: Trip, day_id: uuid.UUID | None) -> None:
    if day_id is None:
        return
    found = await db.execute(
        select(ItineraryDay.id).where(ItineraryDay.id == day_id, ItineraryDay.trip_id == trip.id)
    )
    if found.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Itinerary day not found")


async def _get_expense(db: AsyncSession, trip_id: uuid.UUID, expense_id: uuid.UUID) -> TripExpense:
    expense = (
        await db.execute(
            select(TripExpense).where(TripExpense.id == expense_id, TripExpense.trip_id == trip_id)
        )
    ).scalar_one_or_none()
    if expense is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Expense not found")
    return expense


@router.get("/expenses", response_model=list[ExpenseOut])
async def list_expenses(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> list[ExpenseOut]:
    await get_owned_trip(db, trip_id, current_user.id)
    rows = (
        await db.execute(
            select(TripExpense)
            .where(TripExpense.trip_id == trip_id)
            .order_by(TripExpense.spent_on, TripExpense.created_at)
        )
    ).scalars()
    return [ExpenseOut.model_validate(r) for r in rows]


@router.post("/expenses", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(
    trip_id: uuid.UUID, body: ExpenseCreate, current_user: CurrentUser, db: DB
) -> ExpenseOut:
    trip = await get_owned_trip(db, trip_id, current_user.id)
    await _check_day(db, trip, body.itinerary_day_id)
    expense = TripExpense(trip_id=trip_id, **body.model_dump(exclude_none=True))
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    return ExpenseOut.model_validate(expense)


@router.patch("/expenses/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    trip_id: uuid.UUID,
    expense_id: uuid.UUID,
    body: ExpenseUpdate,
    current_user: CurrentUser,
    db: DB,
) -> ExpenseOut:
    trip = await get_owned_trip(db, trip_id, current_user.id)
    expense = await _get_expense(db, trip_id, expense_id)
    changes = body.model_dump(exclude_unset=True)
    for required in ("category", "amount", "spent_on"):
        if required in changes and changes[required] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{required} cannot be null")
    await _check_day(db, trip, changes.get("itinerary_day_id"))
    for field, value in changes.items():
        setattr(expense, field, value)
    await db.commit()
    await db.refresh(expense)
    return ExpenseOut.model_validate(expense)


@router.delete("/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    trip_id: uuid.UUID, expense_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    await get_owned_trip(db, trip_id, current_user.id)
    await db.delete(await _get_expense(db, trip_id, expense_id))
    await db.commit()


@router.get("/budget", response_model=BudgetOut)
async def get_budget(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> BudgetOut:
    trip = await get_owned_trip(
        db,
        trip_id,
        current_user.id,
        selectinload(Trip.itinerary_days).selectinload(ItineraryDay.waypoints),
    )
    mpg, price = float(trip.vehicle_mpg), float(trip.fuel_price_per_unit)

    # Fuel comes from the stored route, so this makes no API call. For radius trips the
    # route is the built itinerary's, which is what total_distance_meters holds.
    fuel_by_day = {
        str(day.id): fuel_estimate(
            sum(w.distance_meters_from_prev or 0 for w in day.waypoints), mpg, price
        )
        for day in trip.itinerary_days
    }

    spent: dict[str, float] = defaultdict(float)
    rows = (
        await db.execute(select(TripExpense.category, TripExpense.amount).where(TripExpense.trip_id == trip_id))
    ).all()
    for category, amount in rows:
        spent[category] += float(amount)
    spent_by_category = {c: round(spent.get(c, 0.0), 2) for c in EXPENSE_CATEGORIES}
    spent_total = round(sum(spent_by_category.values()), 2)
    budget_total = float(trip.budget_total) if trip.budget_total is not None else None

    return BudgetOut(
        currency=trip.currency,
        vehicle_mpg=mpg,
        fuel_price_per_unit=price,
        distance_miles=round((trip.total_distance_meters or 0) / METERS_PER_MILE, 1),
        estimated_fuel=fuel_estimate(trip.total_distance_meters, mpg, price),
        fuel_by_day=fuel_by_day,
        budget_total=budget_total,
        spent_by_category=spent_by_category,
        spent_total=spent_total,
        remaining=None if budget_total is None else round(budget_total - spent_total, 2),
    )
