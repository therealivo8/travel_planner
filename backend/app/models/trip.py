import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

TripModeEnum = Enum("point_to_point", "radius", name="trip_mode")
TripStatusEnum = Enum("draft", "planned", "completed", name="trip_status")


class Trip(Base):
    __tablename__ = "trips"
    __table_args__ = (
        CheckConstraint(
            "mode = 'radius' OR (end_lat IS NOT NULL AND end_lng IS NOT NULL)",
            name="ck_trips_point_to_point_coords",
        ),
        CheckConstraint(
            "mode = 'point_to_point' OR max_drive_minutes IS NOT NULL",
            name="ck_trips_radius_drive_minutes",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    mode: Mapped[str] = mapped_column(TripModeEnum, nullable=False)
    status: Mapped[str] = mapped_column(TripStatusEnum, nullable=False, server_default="draft")
    start_address: Mapped[str] = mapped_column(Text, nullable=False)
    start_lat: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    start_lng: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    end_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    end_lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    end_lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    max_drive_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 3: route calculation results
    total_distance_meters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_drive_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    route_polyline: Mapped[str | None] = mapped_column(Text, nullable=True)
    route_raw_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    waypoints: Mapped[list["Waypoint"]] = relationship(
        "Waypoint", back_populates="trip", cascade="all, delete-orphan", order_by="Waypoint.position"
    )


class Waypoint(Base):
    __tablename__ = "waypoints"
    __table_args__ = (
        UniqueConstraint("trip_id", "position", name="uq_waypoints_trip_position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    trip_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trips.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    lat: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    lng: Mapped[float] = mapped_column(Numeric(10, 7), nullable=False)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    stop_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 3: per-leg routing data
    drive_seconds_from_prev: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_meters_from_prev: Mapped[int | None] = mapped_column(Integer, nullable=True)
    place_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    trip: Mapped["Trip"] = relationship("Trip", back_populates="waypoints")
