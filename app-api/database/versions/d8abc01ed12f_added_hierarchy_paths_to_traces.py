"""added hierarchy paths to traces

Revision ID: d8abc01ed12f
Revises: 5b89c5fb6059
Create Date: 2024-11-05 10:27:55.655232

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8abc01ed12f'
down_revision: Union[str, None] = '5b89c5fb6059'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('traces', sa.Column('hierarchy_path', sa.ARRAY(sa.String()), nullable=False, default=[], server_default='{}'))


def downgrade() -> None:
    op.drop_column('traces', 'hierarchy_path')
