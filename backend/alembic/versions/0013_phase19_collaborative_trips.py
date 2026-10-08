"""phase19 collaborative trips: members, invites, votes, comments, activity, version

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-09 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _enum(name: str, *values: str) -> postgresql.ENUM:
    return postgresql.ENUM(*values, name=name, create_type=False)


def upgrade() -> None:
    for name, values in (
        ("member_role", ("editor", "viewer")),
        ("vote_kind", ("radius", "corridor", "waypoint")),
        ("comment_kind", ("trip", "day", "waypoint")),
    ):
        postgresql.ENUM(*values, name=name).create(op.get_bind(), checkfirst=True)

    op.add_column("trips", sa.Column("version", sa.Integer(), server_default="1", nullable=False))
    op.add_column(
        "users", sa.Column("last_seen_activity_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.create_table(
        "trip_members",
        sa.Column("trip_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("role", _enum("member_role", "editor", "viewer"), nullable=False),
        sa.Column("invited_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("trip_id", "user_id"),
    )
    op.create_index("ix_trip_members_user_id", "trip_members", ["user_id"])

    op.create_table(
        "trip_invites",
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("id", UUID, nullable=False),
        sa.Column("trip_id", UUID, nullable=False),
        sa.Column("role", _enum("member_role", "editor", "viewer"), nullable=False),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("max_uses", sa.Integer(), server_default="10", nullable=False),
        sa.Column("uses", sa.Integer(), server_default="0", nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("token_hash"),
        sa.UniqueConstraint("id"),
    )
    op.create_index("ix_trip_invites_trip_id", "trip_invites", ["trip_id"])

    op.create_table(
        "stop_votes",
        sa.Column("suggestion_kind", _enum("vote_kind", "radius", "corridor", "waypoint"), nullable=False),
        sa.Column("target_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("value", sa.SmallInteger(), nullable=False),
        sa.Column("trip_id", UUID, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("suggestion_kind", "target_id", "user_id"),
        sa.CheckConstraint("value IN (-1, 1)", name="ck_stop_votes_value"),
    )
    op.create_index("ix_stop_votes_trip_id", "stop_votes", ["trip_id"])

    op.create_table(
        "trip_comments",
        sa.Column("id", UUID, nullable=False),
        sa.Column("trip_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("target_kind", _enum("comment_kind", "trip", "day", "waypoint"), nullable=False),
        sa.Column("target_id", UUID, nullable=True),
        sa.Column("body", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trip_comments_trip_id", "trip_comments", ["trip_id"])

    op.create_table(
        "trip_activity",
        sa.Column("id", UUID, nullable=False),
        sa.Column("trip_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("summary", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trip_activity_trip_id", "trip_activity", ["trip_id"])
    op.create_index("ix_trip_activity_created_at", "trip_activity", ["created_at"])


def downgrade() -> None:
    op.drop_table("trip_activity")
    op.drop_table("trip_comments")
    op.drop_table("stop_votes")
    op.drop_table("trip_invites")
    op.drop_table("trip_members")
    op.drop_column("users", "last_seen_activity_at")
    op.drop_column("trips", "version")
    for name in ("comment_kind", "vote_kind", "member_role"):
        op.execute(f"DROP TYPE {name}")
