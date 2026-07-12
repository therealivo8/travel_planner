"""phase5 trip management

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-09 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # itinerary_days table
    op.create_table(
        "itinerary_days",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "trip_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("trips.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("day_number", sa.SmallInteger, nullable=False),
        sa.Column("date", sa.Date, nullable=True),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.UniqueConstraint("trip_id", "day_number", name="uq_itinerary_days_trip_day"),
    )

    # waypoints — Phase 5 columns
    op.add_column(
        "waypoints",
        sa.Column(
            "itinerary_day_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("itinerary_days.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    op.add_column("waypoints", sa.Column("scheduled_arrival_time", sa.Time, nullable=True))

    # trips — Phase 5 columns
    op.add_column("trips", sa.Column("share_token", sa.String(64), unique=True, nullable=True))
    op.add_column("trips", sa.Column("is_public", sa.Boolean, nullable=False, server_default="false"))
    op.add_column("trips", sa.Column("start_date", sa.Date, nullable=True))
    op.add_column("trips", sa.Column("cover_image_url", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("trips", "cover_image_url")
    op.drop_column("trips", "start_date")
    op.drop_column("trips", "is_public")
    op.drop_column("trips", "share_token")
    op.drop_column("waypoints", "scheduled_arrival_time")
    op.drop_column("waypoints", "itinerary_day_id")
    op.drop_table("itinerary_days")
