import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

UnitsEnum = Enum("imperial", "metric", name="units_system")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Phase 15: preferences and session revocation
    units: Mapped[str] = mapped_column(UnitsEnum, nullable=False, server_default="imperial")
    home_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Saved with the address so a new trip can start from home without a geocode call.
    home_lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    home_lng: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    default_stop_minutes: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="60"
    )
    # Phase 19: activity and comments newer than this count as unread in the bell.
    last_seen_activity_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Phase 17: bytes of trip photos stored in R2 (for the per-user limit).
    storage_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    # Tokens issued before this moment are rejected (password change/reset).
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class PasswordResetToken(Base):
    """Only the sha256 of the emailed token is stored, never the token itself."""

    __tablename__ = "password_reset_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
