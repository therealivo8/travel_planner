"""phase4 radius mode

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-07 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # trips — cached isochrone polygon for radius trips
    op.add_column("trips", sa.Column("radius_isochrone_geojson", postgresql.JSONB, nullable=True))

    # radius_suggestions table
    op.create_table(
        "radius_suggestions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "trip_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("trips.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("place_id", sa.String(300), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("address", sa.Text, nullable=False),
        sa.Column("lat", sa.Numeric(10, 7), nullable=False),
        sa.Column("lng", sa.Numeric(10, 7), nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("drive_seconds_from_start", sa.Integer, nullable=False),
        sa.Column("distance_meters_from_start", sa.Integer, nullable=False),
        sa.Column("rating", sa.Numeric(3, 1), nullable=True),
        sa.Column("selected", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("radius_suggestions")
    op.drop_column("trips", "radius_isochrone_geojson")
