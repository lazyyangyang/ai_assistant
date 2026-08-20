"""add chat message generation status

Revision ID: 8d2f4a7c91b0
Revises: 4b3e3602294c
Create Date: 2026-08-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8d2f4a7c91b0"
down_revision: Union[str, Sequence[str], None] = "4b3e3602294c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="COMPLETED",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "status")
