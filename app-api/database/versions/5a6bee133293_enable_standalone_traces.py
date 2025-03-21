"""enable standalone traces

Revision ID: 5a6bee133293
Revises: 1aae976188c7
Create Date: 2024-08-23 12:56:34.736532

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5a6bee133293'
down_revision: Union[str, None] = '1aae976188c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column('traces', sa.Column('user_id', sa.UUID(), nullable=True))
    op.alter_column('traces', 'dataset_id',
               existing_type=sa.UUID(),
               nullable=True)
    
    # set trace user_id's to their dataset's user_id
    op.execute('UPDATE traces SET user_id = datasets.user_id FROM datasets WHERE traces.dataset_id = datasets.id')
    # make sure all traces have a user_id
    op.alter_column('traces', 'user_id', existing_type=sa.UUID(), nullable=False)
    
    op.create_foreign_key(None, 'traces', 'users', ['user_id'], ['id'])
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint(None, 'traces', type_='foreignkey')
    op.alter_column('traces', 'dataset_id',
               existing_type=sa.UUID(),
               nullable=False)
    op.drop_column('traces', 'user_id')
    # ### end Alembic commands ###
