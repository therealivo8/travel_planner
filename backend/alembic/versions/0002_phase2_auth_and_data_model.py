"""phase2 auth and data model

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-02 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Enums ---
    trip_mode = postgresql.ENUM("point_to_point", "radius", name="trip_mode", create_type=False)
    trip_status = postgresql.ENUM("draft", "planned", "completed", name="trip_status", create_type=False)
    trip_mode.create(op.get_bind(), checkfirst=True)
    trip_status.create(op.get_bind(), checkfirst=True)

    # --- users ---
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String, nullable=False),
        sa.Column("display_name", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # updated_at trigger
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ language 'plpgsql';
    """)
    op.execute("""
        CREATE TRIGGER users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    """)

    # --- trips ---
    op.create_table(
        "trips",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("mode", sa.Enum("point_to_point", "radius", name="trip_mode"), nullable=False),
        sa.Column("status", sa.Enum("draft", "planned", "completed", name="trip_status"), nullable=False, server_default="draft"),
        sa.Column("start_address", sa.Text, nullable=False),
        sa.Column("start_lat", sa.Numeric(10, 7), nullable=False),
        sa.Column("start_lng", sa.Numeric(10, 7), nullable=False),
        sa.Column("end_address", sa.Text, nullable=True),
        sa.Column("end_lat", sa.Numeric(10, 7), nullable=True),
        sa.Column("end_lng", sa.Numeric(10, 7), nullable=True),
        sa.Column("max_drive_minutes", sa.Integer, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "mode = 'radius' OR (end_lat IS NOT NULL AND end_lng IS NOT NULL)",
            name="ck_trips_point_to_point_coords",
        ),
        sa.CheckConstraint(
            "mode = 'point_to_point' OR max_drive_minutes IS NOT NULL",
            name="ck_trips_radius_drive_minutes",
        ),
    )
    op.create_index("ix_trips_user_id", "trips", ["user_id"])
    op.execute("""
        CREATE TRIGGER trips_updated_at
        BEFORE UPDATE ON trips
        FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    """)

    # --- waypoints ---
    op.create_table(
        "waypoints",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("trip_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.SmallInteger, nullable=False),
        sa.Column("address", sa.Text, nullable=False),
        sa.Column("lat", sa.Numeric(10, 7), nullable=False),
        sa.Column("lng", sa.Numeric(10, 7), nullable=False),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("stop_duration_minutes", sa.Integer, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("trip_id", "position", name="uq_waypoints_trip_position"),
    )
    op.create_index("ix_waypoints_trip_id", "waypoints", ["trip_id"])


def downgrade() -> None:
    op.drop_table("waypoints")

    op.execute("DROP TRIGGER IF EXISTS trips_updated_at ON trips")
    op.drop_table("trips")

    op.execute("DROP TRIGGER IF EXISTS users_updated_at ON users")
    op.drop_table("users")

    op.execute("DROP FUNCTION IF EXISTS update_updated_at_column")

    op.execute("DROP TYPE IF EXISTS trip_status")
    op.execute("DROP TYPE IF EXISTS trip_mode")
