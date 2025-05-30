"""add time_last_pushed to dataset and trace

Revision ID: 4a18807f9aad
Revises: 83097c7e026b
Create Date: 2025-05-30 10:19:18.005408

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4a18807f9aad"
down_revision: Union[str, None] = "83097c7e026b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add columns with nullable=True to allow default assignment
    op.add_column(
        "datasets",
        sa.Column("time_last_pushed", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "traces",
        sa.Column("time_last_pushed", sa.DateTime(timezone=True), nullable=True),
    )

    # Copy existing time_created into time_last_pushed
    op.execute("UPDATE traces SET time_last_pushed = time_created")

    # Set dataset time_last_pushed as max of time_created from associated traces
    op.execute("""
        UPDATE datasets
        SET time_last_pushed = subquery.max_time_created
        FROM (
            SELECT dataset_id, MAX(time_created) AS max_time_created
            FROM traces
            WHERE dataset_id IS NOT NULL
            GROUP BY dataset_id
        ) AS subquery
        WHERE datasets.id = subquery.dataset_id
    """)

    # Set fallback to time_created if no traces present
    op.execute(
        "UPDATE datasets SET time_last_pushed = time_created WHERE time_last_pushed IS NULL"
    )

    # Alter to enforce non-null constraint
    op.alter_column("datasets", "time_last_pushed", nullable=False)
    op.alter_column("traces", "time_last_pushed", nullable=False)

    # Create a trigger function to update dataset time_last_pushed on trace insert/update
    op.execute("""
    CREATE OR REPLACE FUNCTION update_dataset_time_last_pushed()
    RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.dataset_id IS NOT NULL THEN
            UPDATE datasets
            SET time_last_pushed = GREATEST(NEW.time_last_pushed, time_last_pushed)
            WHERE id = NEW.dataset_id;
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    # Attach the trigger to the traces table
    op.execute("""
    CREATE TRIGGER trg_update_dataset_time_last_pushed
    AFTER INSERT OR UPDATE OF time_last_pushed ON traces
    FOR EACH ROW
    EXECUTE FUNCTION update_dataset_time_last_pushed();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_update_dataset_time_last_pushed ON traces")
    op.execute("DROP FUNCTION IF EXISTS update_dataset_time_last_pushed")
    op.drop_column("traces", "time_last_pushed")
    op.drop_column("datasets", "time_last_pushed")
