"""phase7 corridor stops

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-13 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "corridor_suggestions",
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
        sa.Column("rating", sa.Numeric(3, 1), nullable=True),
        sa.Column("detour_seconds", sa.Integer, nullable=False),
        sa.Column("route_fraction", sa.Numeric(5, 4), nullable=False),
        sa.Column("selected", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("corridor_suggestions")
