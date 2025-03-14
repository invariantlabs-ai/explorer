"""Migrate dataset level trace index to sequences

Revision ID: 83097c7e026b
Revises: 1824436b3cf9
Create Date: 2025-03-11 16:24:53.276229

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "83097c7e026b"
down_revision: Union[str, None] = "1824436b3cf9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    connection = op.get_bind()

    # Step 1: Get all dataset_id values (casted as TEXT since they are UUIDs)
    dataset_ids = connection.execute(
        sa.text(
            "SELECT DISTINCT dataset_id::TEXT FROM traces WHERE dataset_id IS NOT NULL"
        )
    ).fetchall()

    # Step 2: Create a sequence for each dataset_id and set it to start at MAX(index) + 1
    for (dataset_id,) in dataset_ids:
        max_index = connection.execute(
            sa.text(
                "SELECT COALESCE(MAX(index), -1) FROM traces WHERE dataset_id = :dataset_id"
            ),
            {"dataset_id": dataset_id},
        ).scalar()
        next_index = max_index + 1

        sequence_name = f"dataset_seq_{dataset_id.replace('-', '_')}"

        # Drop the sequence if it already exists (to avoid conflicts)
        connection.execute(sa.text(f"DROP SEQUENCE IF EXISTS {sequence_name}"))

        # Create a new sequence starting from the next index
        connection.execute(
            sa.text(
                f"CREATE SEQUENCE {sequence_name} START WITH {next_index} MINVALUE 0"
            )
        )

    # Step 3: Create the trigger function
    connection.execute(
        sa.text("""
    CREATE OR REPLACE FUNCTION set_trace_index() RETURNS TRIGGER AS $$
    DECLARE
        seq_name TEXT;
        new_index INTEGER;
        start_index INTEGER;
    BEGIN
        -- Only assign index via the sequence if dataset_id is NOT NULL and index is NULL
        IF NEW.dataset_id IS NOT NULL AND NEW.index is NULL THEN
            -- Generate a unique sequence name for this dataset_id
            seq_name := 'dataset_seq_' || replace(NEW.dataset_id::TEXT, '-', '_');

            -- Try to get the next value; if the sequence does not exist, create it
            BEGIN
                EXECUTE format('SELECT nextval(''%s'')', seq_name) INTO new_index;
            EXCEPTION
                WHEN undefined_table THEN
                    -- Calculate start value based on the current max index
                    -- If there are no traces, start at 0
                    -- Otherwise, start at the current max index + 1
                    -- This is possible when a jsonl file is uploaded with indices
                    SELECT COALESCE(MAX(index), -1) + 1 INTO start_index FROM traces WHERE dataset_id = NEW.dataset_id;

                    EXECUTE format('CREATE SEQUENCE %I START WITH %s MINVALUE 0', seq_name, start_index);
                    EXECUTE format('SELECT nextval(''%s'')', seq_name) INTO new_index;
            END;

            -- Set the computed index
            NEW.index := new_index;
        ELSIF NEW.dataset_id IS NULL THEN
            NEW.index := 0;
        END IF;

        -- Ensure 'name' is set correctly
        IF NEW.name IS NULL OR NEW.name = '' THEN
            NEW.name := 'Run ' || COALESCE(NEW.index, 0);
        END IF;

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)
    )

    # Step 4: Create the trigger
    connection.execute(
        sa.text("""
    CREATE TRIGGER trigger_set_trace_index
    BEFORE INSERT ON traces
    FOR EACH ROW
    EXECUTE FUNCTION set_trace_index();
    """)
    )


def downgrade():
    connection = op.get_bind()

    # Step 1: Drop the trigger
    connection.execute(
        sa.text("DROP TRIGGER IF EXISTS trigger_set_trace_index ON traces;")
    )

    # Step 2: Drop the trigger function
    connection.execute(sa.text("DROP FUNCTION IF EXISTS set_trace_index;"))

    # Step 3: Drop all dataset sequences
    dataset_ids = connection.execute(
        sa.text(
            "SELECT DISTINCT dataset_id::TEXT FROM traces WHERE dataset_id IS NOT NULL"
        )
    ).fetchall()

    for (dataset_id,) in dataset_ids:
        sequence_name = f"dataset_seq_{dataset_id.replace('-', '_')}"
        connection.execute(sa.text(f"DROP SEQUENCE IF EXISTS {sequence_name}"))
