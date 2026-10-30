"""Request/response schemas."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.chat import AgentType, SessionStatus


# ── Auth ──────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    session_id: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: str
    username: str
    email: str

    model_config = {"from_attributes": True}


# ── Chat ──────────────────────────────────────────────

class ChatMessageIn(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    agent_type: str = Field(pattern=r"^(jd|resume|interview)$")
    messages: list[ChatMessageIn]
    session_id: str | None = None
    resume_id: str | None = None
    jd_context: dict[str, object] | None = None


class ChatSessionOut(BaseModel):
    id: str
    agent_type: AgentType
    title: str
    status: SessionStatus
    resume_id: str | None = None
    jd_content: str | None = None
    feedback: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageOut(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Resume ────────────────────────────────────────────

class ResumeOut(BaseModel):
    id: str
    version: int
    title: str
    content: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ResumeUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    is_active: bool | None = None


class ResumeCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1)
    is_active: bool = True


# ── STT ──────────────────────────────────────────────
class TranscribeResponse(BaseModel):
    text: str


# ── TTS ──────────────────────────────────────────────
class TtsSynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    # Optional overrides so different providers can tune voice/model.
    voice: str | None = None
    model: str | None = None
