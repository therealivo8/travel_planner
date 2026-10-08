import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

EXPENSE_CATEGORIES = ("fuel", "lodging", "food", "activities", "other")
ExpenseCategoryEnum = Enum(*EXPENSE_CATEGORIES, name="expense_category")


class TripExpense(Base):
    __tablename__ = "trip_expenses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True
    )
    itinerary_day_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("itinerary_days.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str] = mapped_column(ExpenseCategoryEnum, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    spent_on: Mapped[date] = mapped_column(Date, nullable=False, server_default=func.current_date())
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WeatherCache(Base):
    """Open-Meteo daily forecast per ~1 km cell and date, with a short TTL."""

    __tablename__ = "weather_cache"

    lat_key: Mapped[str] = mapped_column(String(10), primary_key=True)
    lng_key: Mapped[str] = mapped_column(String(10), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PackingItem(Base):
    __tablename__ = "packing_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False, server_default="Other")
    packed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")
