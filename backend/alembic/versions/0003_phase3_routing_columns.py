"""phase3 routing columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # trips — routing summary columns
    op.add_column("trips", sa.Column("total_distance_meters", sa.Integer, nullable=True))
    op.add_column("trips", sa.Column("total_drive_seconds", sa.Integer, nullable=True))
    op.add_column("trips", sa.Column("route_polyline", sa.Text, nullable=True))
    op.add_column("trips", sa.Column("route_raw_response", postgresql.JSONB, nullable=True))

    # waypoints — per-leg routing columns
    op.add_column("waypoints", sa.Column("drive_seconds_from_prev", sa.Integer, nullable=True))
    op.add_column("waypoints", sa.Column("distance_meters_from_prev", sa.Integer, nullable=True))
    op.add_column("waypoints", sa.Column("place_id", sa.String(300), nullable=True))


def downgrade() -> None:
    op.drop_column("waypoints", "place_id")
    op.drop_column("waypoints", "distance_meters_from_prev")
    op.drop_column("waypoints", "drive_seconds_from_prev")

    op.drop_column("trips", "route_raw_response")
    op.drop_column("trips", "route_polyline")
    op.drop_column("trips", "total_drive_seconds")
    op.drop_column("trips", "total_distance_meters")
