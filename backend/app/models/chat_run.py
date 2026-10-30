"""Durable JD generation admission records; execution is independent of HTTP."""
from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class ChatRun(Base):
    __tablename__ = "chat_runs"
    __table_args__ = (UniqueConstraint("user_id", "client_request_id"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    client_request_id: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    input_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    phase: Mapped[str] = mapped_column(String(24), default="analysis")
    user_message_id: Mapped[str] = mapped_column(ForeignKey("chat_messages.id"))
    assistant_message_id: Mapped[str] = mapped_column(ForeignKey("chat_messages.id"))
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    worker_id: Mapped[str | None] = mapped_column(String(128))
    lease_until: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(64))
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    result_text: Mapped[str] = mapped_column(Text, default="")
    structured_json: Mapped[str | None] = mapped_column(Text)
