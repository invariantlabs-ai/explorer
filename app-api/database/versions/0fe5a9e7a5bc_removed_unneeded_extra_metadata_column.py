"""removed unneeded extra metadata column

Revision ID: 0fe5a9e7a5bc
Revises: 8cd93507c8f3
Create Date: 2024-08-15 13:43:32.684998

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0fe5a9e7a5bc'
down_revision: Union[str, None] = '8cd93507c8f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column('annotations', 'extra_metadata')
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column('annotations', sa.Column('extra_metadata', sa.VARCHAR(), autoincrement=False, nullable=False))
    # ### end Alembic commands ###
