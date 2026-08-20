"""Declarative base with common mixins."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Give every persisted entity a stable string ID and server-owned timestamps."""

    id: Mapped[str] = mapped_column(
        primary_key=True,
        default=lambda: uuid.uuid4().hex,
    )
    created_at: Mapped[datetime] = mapped_column(
        # Database defaults also cover migrations, scripts and inserts that do not
        # pass through the ORM application process.
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
