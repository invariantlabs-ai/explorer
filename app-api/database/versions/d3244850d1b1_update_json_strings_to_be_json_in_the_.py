"""update JSON-strings to be JSON in the database

Revision ID: d3244850d1b1
Revises: e8299c9fd4fb
Create Date: 2024-09-03 12:26:12.737988

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3244850d1b1'
down_revision: Union[str, None] = 'e8299c9fd4fb'
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
                EXCEPTION WHEN OTHERS THEN return ('{old_data: }'||str)::json;
                END
                $$;
               """)

    op.execute("""
    UPDATE traces
    SET extra_metadata=to_json(replace(substr(extra_metadata::text, 2, length(extra_metadata::text) - 2), '\"', '"' ))
    WHERE extra_metadata::text LIKE '"%"'
    """)
    op.execute("""
    UPDATE datasets
    SET extra_metadata=to_json(replace(substr(extra_metadata::text, 2, length(extra_metadata::text) - 2), '\"', '"' ))
    WHERE extra_metadata::text LIKE '"%"'
    """)

def downgrade() -> None:
    pass
