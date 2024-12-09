"""make sure snippets are also up to correct JSON format (like other traces)

Revision ID: ca8b6c370502
Revises: bb590e17b7fc
Create Date: 2024-09-16 16:47:47.296392

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ca8b6c370502'
down_revision: Union[str, None] = 'bb590e17b7fc'
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


def downgrade() -> None:
    pass
