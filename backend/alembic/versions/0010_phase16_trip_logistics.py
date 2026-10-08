"""phase16 trip logistics: costs, expenses, weather cache, packing

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-08 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CATEGORIES = ("fuel", "lodging", "food", "activities", "other")


def upgrade() -> None:
    op.add_column(
        "trips",
        sa.Column("vehicle_mpg", sa.Numeric(4, 1), server_default="28.0", nullable=False),
    )
    op.add_column(
        "trips",
        sa.Column("fuel_price_per_unit", sa.Numeric(5, 2), server_default="3.50", nullable=False),
    )
    op.add_column("trips", sa.Column("budget_total", sa.Numeric(10, 2), nullable=True))
    op.add_column("trips", sa.Column("currency", sa.String(3), server_default="USD", nullable=False))
    op.add_column("trips", sa.Column("timezone", sa.String(64), server_default="UTC", nullable=False))

    op.create_table(
        "trip_expenses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("itinerary_day_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("category", postgresql.ENUM(*CATEGORIES, name="expense_category"), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("spent_on", sa.Date(), server_default=sa.func.current_date(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["itinerary_day_id"], ["itinerary_days.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trip_expenses_trip_id", "trip_expenses", ["trip_id"])

    op.create_table(
        "weather_cache",
        sa.Column("lat_key", sa.String(10), nullable=False),
        sa.Column("lng_key", sa.String(10), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("lat_key", "lng_key", "date"),
    )

    op.create_table(
        "packing_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("category", sa.String(40), server_default="Other", nullable=False),
        sa.Column("packed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("position", sa.SmallInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_packing_items_trip_id", "packing_items", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_packing_items_trip_id", table_name="packing_items")
    op.drop_table("packing_items")
    op.drop_table("weather_cache")
    op.drop_index("ix_trip_expenses_trip_id", table_name="trip_expenses")
    op.drop_table("trip_expenses")
    op.execute("DROP TYPE expense_category")
    for col in ("timezone", "currency", "budget_total", "fuel_price_per_unit", "vehicle_mpg"):
        op.drop_column("trips", col)
