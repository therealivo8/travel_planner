"""phase17 check-ins, photos, recap sharing

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-08 22:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("waypoints", sa.Column("visited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "waypoints", sa.Column("skipped", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "trips", sa.Column("share_recap", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "users", sa.Column("storage_bytes", sa.BigInteger(), server_default="0", nullable=False)
    )
    op.create_table(
        "trip_photos",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("waypoint_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("itinerary_day_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("object_key", sa.String(300), nullable=False),
        sa.Column("width", sa.SmallInteger(), nullable=False),
        sa.Column("height", sa.SmallInteger(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("caption", sa.String(300), nullable=True),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["waypoint_id"], ["waypoints.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["itinerary_day_id"], ["itinerary_days.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_index("ix_trip_photos_trip_id", "trip_photos", ["trip_id"])
    op.create_table(
        "pending_object_deletes",
        sa.Column("object_key", sa.String(300), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("object_key"),
    )


def downgrade() -> None:
    op.drop_table("pending_object_deletes")
    op.drop_index("ix_trip_photos_trip_id", table_name="trip_photos")
    op.drop_table("trip_photos")
    op.drop_column("users", "storage_bytes")
    op.drop_column("trips", "share_recap")
    op.drop_column("waypoints", "skipped")
    op.drop_column("waypoints", "visited_at")
