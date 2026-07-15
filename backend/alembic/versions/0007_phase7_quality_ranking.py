"""phase7 quality ranking

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-14 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "radius_suggestions", sa.Column("user_ratings_total", sa.Integer, nullable=True)
    )
    op.add_column(
        "corridor_suggestions", sa.Column("user_ratings_total", sa.Integer, nullable=True)
    )


def downgrade() -> None:
    op.drop_column("corridor_suggestions", "user_ratings_total")
    op.drop_column("radius_suggestions", "user_ratings_total")
