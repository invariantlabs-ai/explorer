"""initial structure

Revision ID: b7c27b731345
Revises: 
Create Date: 2024-08-14 15:18:11.268009

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c27b731345'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('datasets',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('path', sa.String(), nullable=False),
    sa.Column('extra_metadata', sa.String(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('traces',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('index', sa.Integer(), nullable=False),
    sa.Column('dataset_id', sa.UUID(), nullable=False),
    sa.Column('content', sa.String(), nullable=False),
    sa.Column('extra_metadata', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['dataset_id'], ['datasets.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('annotations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('trace_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('content', sa.String(), nullable=False),
    sa.Column('address', sa.String(), nullable=False),
    sa.Column('extra_metadata', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['trace_id'], ['traces.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('shared_links',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('trace_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['trace_id'], ['traces.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table('shared_links')
    op.drop_table('annotations')
    op.drop_table('traces')
    op.drop_table('datasets')
    # ### end Alembic commands ###
