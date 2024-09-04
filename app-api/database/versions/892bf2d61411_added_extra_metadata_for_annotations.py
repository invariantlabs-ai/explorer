"""added extra_metadata for annotations

Revision ID: 892bf2d61411
Revises: d3244850d1b1
Create Date: 2024-09-04 22:00:15.777983

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '892bf2d61411'
down_revision: Union[str, None] = 'd3244850d1b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('annotations', sa.Column('extra_metadata', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('annotations', 'extra_metadata')