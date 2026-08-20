"""Chat session & message models for persistent conversation history."""

from sqlalchemy import Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

import enum


class AgentType(str, enum.Enum):
    JD = "jd"
    RESUME = "resume"
    INTERVIEW = "interview"


class SessionStatus(str, enum.Enum):
    ACTIVE = "active"
    COMPLETED = "completed"


class MessageStatus(str, enum.Enum):
    """Durable lifecycle of an assistant response, independent of the SSE connection."""
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"
    STOPPED = "stopped"


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    agent_type: Mapped[AgentType] = mapped_column(Enum(AgentType))
    title: Mapped[str] = mapped_column(String(128), default="新对话")
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus), default=SessionStatus.ACTIVE,
    )
    jd_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    resume_id: Mapped[str | None] = mapped_column(
        ForeignKey("resumes.id"), nullable=True,
    )
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="chat_sessions")  # noqa: F821
    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    session_id: Mapped[str] = mapped_column(
        ForeignKey("chat_sessions.id"), index=True,
    )
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[MessageStatus] = mapped_column(
        # native_enum=False keeps SQLite and PostgreSQL migrations compatible;
        # the Python enum still validates the finite state values in application code.
        Enum(MessageStatus, native_enum=False, length=16),
        default=MessageStatus.COMPLETED,
    )

    session: Mapped["ChatSession"] = relationship(back_populates="messages")
