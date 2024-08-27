"""update annotation addresses

Revision ID: e6e3d9711298
Revises: e44c2a92c154
Create Date: 2024-08-27 17:50:32.219525

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e6e3d9711298'
down_revision: Union[str, None] = 'e44c2a92c154'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # def translate(address):
    # # //   annotation.address = (annotation.address.slice(0, -2) + ":L0").replace(/message/g, 'messages')
    # if address.endswith(".0"):
    #     return (address[:-2] + ":L0").replace("message", "messages")
    # return address
    # in the annotations table update all 'address' fields like this
    op.execute("UPDATE annotations SET address = (substr(address, 0, length(address) - 1) || '\:L0') WHERE address LIKE '%.0';")
    op.execute("UPDATE annotations SET address = replace(address, 'message[', 'messages[') WHERE address LIKE '%message[%';")


def downgrade() -> None:
    op.execute("UPDATE annotations SET address = replace(address, 'messages[', 'message[') WHERE address LIKE '%messages[%';")
    op.execute("UPDATE annotations SET address = replace(address, '\:L0', '.0') WHERE address LIKE '%:L0';")
