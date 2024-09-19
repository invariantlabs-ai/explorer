"""make content stored as JSON

Revision ID: 137113531aa2
Revises: ca8b6c370502
Create Date: 2024-09-16 17:08:04.733992

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '137113531aa2'
down_revision: Union[str, None] = 'ca8b6c370502'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
                CREATE OR REPLACE FUNCTION to_json(str text) RETURNS json LANGUAGE PLPGSQL
                AS $$
                DECLARE
                    j json;
                BEGIN
                    j := str::json;
                    return j;
                EXCEPTION WHEN OTHERS THEN return '{}'::json;
                END
                $$;
               """)

    op.execute("""
    ALTER TABLE traces
    ALTER COLUMN content TYPE JSON USING to_json(content)
    """)


def downgrade() -> None:
    op.alter_column('traces', 'content',
               existing_type=sa.JSON(),
               type_=sa.VARCHAR(),
               existing_nullable=False)