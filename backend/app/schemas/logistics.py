import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ExpenseCategory = Literal["fuel", "lodging", "food", "activities", "other"]


class ExpenseCreate(BaseModel):
    category: ExpenseCategory
    amount: float = Field(ge=0, le=99_999_999)
    note: str | None = Field(default=None, max_length=200)
    spent_on: date | None = None
    itinerary_day_id: uuid.UUID | None = None


class ExpenseUpdate(BaseModel):
    category: ExpenseCategory | None = None
    amount: float | None = Field(default=None, ge=0, le=99_999_999)
    note: str | None = Field(default=None, max_length=200)
    spent_on: date | None = None
    itinerary_day_id: uuid.UUID | None = None


class ExpenseOut(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    itinerary_day_id: uuid.UUID | None
    category: ExpenseCategory
    amount: float
    note: str | None
    spent_on: date
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetOut(BaseModel):
    currency: str
    vehicle_mpg: float
    fuel_price_per_unit: float
    distance_miles: float
    estimated_fuel: float
    fuel_by_day: dict[str, float]
    budget_total: float | None
    spent_by_category: dict[str, float]
    spent_total: float
    remaining: float | None


class DayWeatherOut(BaseModel):
    hi: float | None
    lo: float | None
    precip_pct: int | None
    code: int | None
    sunrise: str | None
    sunset: str | None
    after_dark: bool


class PackingItemOut(BaseModel):
    id: uuid.UUID
    label: str
    category: str
    packed: bool
    position: int

    model_config = {"from_attributes": True}


class PackingItemCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    category: str = Field(default="Other", min_length=1, max_length=40)


class PackingItemUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = Field(default=None, min_length=1, max_length=40)
    packed: bool | None = None


class PackingTemplateOut(BaseModel):
    name: str
    item_count: int


class PackingSuggestionOut(BaseModel):
    template: str
    reason: str


class NavLink(BaseModel):
    label: str
    url: str


class DayNavigation(BaseModel):
    google: list[NavLink]
    apple: list[NavLink]


class NavigationOut(BaseModel):
    trip: DayNavigation
    days: dict[str, DayNavigation]


