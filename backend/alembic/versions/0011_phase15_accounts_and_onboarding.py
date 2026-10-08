"""phase15 account settings, password reset, example trips

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-08 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    units = postgresql.ENUM("imperial", "metric", name="units_system")
    units.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column(
            "units",
            postgresql.ENUM("imperial", "metric", name="units_system", create_type=False),
            server_default="imperial",
            nullable=False,
        ),
    )
    op.add_column("users", sa.Column("home_address", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("home_lat", sa.Numeric(10, 7), nullable=True))
    op.add_column("users", sa.Column("home_lng", sa.Numeric(10, 7), nullable=True))
    op.add_column(
        "users",
        sa.Column("default_stop_minutes", sa.SmallInteger(), server_default="60", nullable=False),
    )
    op.add_column(
        "users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "trips", sa.Column("is_example", sa.Boolean(), server_default="false", nullable=False)
    )
    op.create_table(
        "password_reset_tokens",
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.drop_column("trips", "is_example")
    for col in (
        "password_changed_at",
        "default_stop_minutes",
        "home_lng",
        "home_lat",
        "home_address",
        "units",
    ):
        op.drop_column("users", col)
    op.execute("DROP TYPE units_system")
