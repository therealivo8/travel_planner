import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, Integer, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ApiUsageDaily(Base):
    """Units of each paid upstream SKU consumed per UTC day (see app.core.budget)."""

    __tablename__ = "api_usage_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    sku: Mapped[str] = mapped_column(String(50), primary_key=True)
    units: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class UserActionDaily(Base):
    """Per-user count of expensive actions per UTC day."""

    __tablename__ = "user_action_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    action: Mapped[str] = mapped_column(String(50), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class IsochroneCache(Base):
    __tablename__ = "isochrone_cache"

    origin_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    minutes: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    geojson: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DiscoveryCache(Base):
    __tablename__ = "discovery_cache"

    cache_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
