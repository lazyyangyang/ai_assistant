import json
import uuid

import pytest
from sqlalchemy import select

from app.auth import decode_access_token
from app.models.chat import ChatMessage, ChatSession


@pytest.mark.asyncio
async def test_chat_stream_requires_auth(async_client):
    resp = await async_client.post(
        "/api/chat/stream",
        json={
            "agent_type": "resume",
            "messages": [{"role": "user", "content": "hello"}],
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_chat_stream_creates_session_and_message(async_client, db_session, monkeypatch):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "test_password_123"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert register_resp.status_code == 201
    token = register_resp.json()["access_token"]
    user_id = decode_access_token(token)
    assert user_id

    async def fake_stream_agent_response(agent_type, history, resume_context=None, jd_context=None):
        # Simulate streaming tokens.
        yield "A"
        yield "B"

    # Router imported `stream_agent_response` into its module namespace.
    import app.routers.chat as chat_router

    monkeypatch.setattr(chat_router, "stream_agent_response", fake_stream_agent_response)

    resp = await async_client.post(
        "/api/chat/stream",
        json={
            "agent_type": "resume",
            "messages": [{"role": "user", "content": "hello"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    body = resp.text
    assert "event: token" in body
    assert "[DONE]" in body

    session_id = resp.headers.get("X-Session-Id") or resp.headers.get("x-session-id")
    assert session_id

    session_result = await db_session.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = session_result.scalar_one_or_none()
    assert session is not None
    assert session.user_id == user_id

    msgs_result = await db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc())
    )
    msgs = msgs_result.scalars().all()
    assert len(msgs) >= 2
    assert msgs[0].role == "user"
    assert msgs[0].content == "hello"
    assert msgs[-1].role == "assistant"
    assert msgs[-1].content == "AB"

