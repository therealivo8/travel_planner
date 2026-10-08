"""phase14 api budget ledger, user quotas, and caches

Revision ID: 0009
Revises: 42c4ea10fa7d
Create Date: 2026-10-08 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0009"
down_revision: str | None = "42c4ea10fa7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_usage_daily",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("sku", sa.String(50), nullable=False),
        sa.Column("units", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("day", "sku"),
    )
    op.create_table(
        "user_action_daily",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("count", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("day", "user_id", "action"),
    )
    op.create_table(
        "isochrone_cache",
        sa.Column("origin_key", sa.String(32), nullable=False),
        sa.Column("minutes", sa.SmallInteger(), nullable=False),
        sa.Column("geojson", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("origin_key", "minutes"),
    )
    op.create_table(
        "discovery_cache",
        sa.Column("cache_key", sa.String(128), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("cache_key"),
    )


def downgrade() -> None:
    op.drop_table("discovery_cache")
    op.drop_table("isochrone_cache")
    op.drop_table("user_action_daily")
    op.drop_table("api_usage_daily")
