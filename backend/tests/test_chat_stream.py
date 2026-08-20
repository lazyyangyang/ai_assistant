import asyncio
import uuid

import pytest
from sqlalchemy import select

from app.auth import decode_access_token
from app.models.chat import AgentType, ChatMessage, ChatSession, MessageStatus
from app.schemas import ChatMessageIn, ChatRequest


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
    persist_calls: list[MessageStatus | None] = []
    original_persist = chat_router._persist_message_state

    async def tracking_persist(*args, **kwargs):
        target_status = kwargs.get("target_status")
        if target_status is None and len(args) >= 5:
            target_status = args[4]
        persist_calls.append(target_status)
        return await original_persist(*args, **kwargs)

    monkeypatch.setattr(chat_router, "_persist_message_state", tracking_persist)

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
    assert msgs[0].status == MessageStatus.COMPLETED
    assert msgs[-1].role == "assistant"
    assert msgs[-1].content == "AB"
    assert msgs[-1].status == MessageStatus.COMPLETED
    assert persist_calls == [MessageStatus.COMPLETED]

    history_resp = await async_client.get(
        f"/api/chat/sessions/{session_id}/messages",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert history_resp.status_code == 200
    assert history_resp.json()[-1]["status"] == "completed"


@pytest.mark.asyncio
async def test_stop_chat_generation_marks_latest_message_stopped(
    async_client,
    db_session,
):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": "test_password_123"},
    )
    token = register_resp.json()["access_token"]
    user_id = decode_access_token(token)
    assert user_id

    session = ChatSession(
        user_id=user_id,
        agent_type=AgentType.RESUME,
        title="stop test",
    )
    db_session.add(session)
    await db_session.commit()
    message = ChatMessage(
        session_id=session.id,
        role="assistant",
        content="partial",
        status=MessageStatus.GENERATING,
    )
    db_session.add(message)
    await db_session.commit()

    stop_resp = await async_client.post(
        f"/api/chat/sessions/{session.id}/stop",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert stop_resp.status_code == 204

    db_session.expire_all()
    message_result = await db_session.execute(
        select(ChatMessage).where(ChatMessage.id == message.id)
    )
    assert message_result.scalar_one().status == MessageStatus.STOPPED

    second_stop_resp = await async_client.post(
        f"/api/chat/sessions/{session.id}/stop",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert second_stop_resp.status_code == 204


def test_should_persist_progress_by_size_or_time():
    from app.routers.chat import _should_persist_progress

    assert not _should_persist_progress(100, 0, 0.2, 256, 0.75)
    assert _should_persist_progress(256, 0, 0.2, 256, 0.75)
    assert _should_persist_progress(100, 0, 0.75, 256, 0.75)


@pytest.mark.asyncio
async def test_closing_stream_marks_assistant_message_stopped(db_session, monkeypatch):
    import app.routers.chat as chat_router

    async def fake_stream_agent_response(agent_type, history, resume_context=None, jd_context=None):
        yield "partial"
        await asyncio.sleep(60)

    monkeypatch.setattr(chat_router, "stream_agent_response", fake_stream_agent_response)

    user_id = uuid.uuid4().hex
    from app.models.user import User

    db_session.add(
        User(
            id=user_id,
            username=f"user_{uuid.uuid4().hex[:8]}",
            email=f"u_{uuid.uuid4().hex}@example.com",
            hashed_password="not-used",
        )
    )
    session = ChatSession(
        user_id=user_id,
        agent_type=AgentType.RESUME,
        title="disconnect test",
    )
    db_session.add(session)
    await db_session.commit()

    generator = chat_router._event_generator(
        ChatRequest(
            agent_type="resume",
            messages=[ChatMessageIn(role="user", content="hello")],
        ),
        db_session,
        session,
        None,
        None,
        asyncio.Event(),
    )
    first_event = await anext(generator)
    assert first_event["event"] == "token"
    await generator.aclose()

    db_session.expire_all()
    message_result = await db_session.execute(
        select(ChatMessage)
        .where(
            ChatMessage.session_id == session.id,
            ChatMessage.role == "assistant",
        )
        .order_by(ChatMessage.created_at.desc())
    )
    assistant_message = message_result.scalars().first()
    assert assistant_message is not None
    assert assistant_message.content == "partial"
    assert assistant_message.status == MessageStatus.STOPPED


@pytest.mark.asyncio
async def test_stream_error_marks_assistant_message_failed(db_session, monkeypatch):
    import app.routers.chat as chat_router
    from app.models.user import User

    async def failing_stream_agent_response(
        agent_type,
        history,
        resume_context=None,
        jd_context=None,
    ):
        yield "partial"
        raise RuntimeError("provider disconnected")

    monkeypatch.setattr(
        chat_router,
        "stream_agent_response",
        failing_stream_agent_response,
    )

    user_id = uuid.uuid4().hex
    db_session.add(
        User(
            id=user_id,
            username=f"user_{uuid.uuid4().hex[:8]}",
            email=f"u_{uuid.uuid4().hex}@example.com",
            hashed_password="not-used",
        )
    )
    session = ChatSession(
        user_id=user_id,
        agent_type=AgentType.RESUME,
        title="failure test",
    )
    db_session.add(session)
    await db_session.commit()

    generator = chat_router._event_generator(
        ChatRequest(
            agent_type="resume",
            messages=[ChatMessageIn(role="user", content="hello")],
        ),
        db_session,
        session,
        None,
        None,
        asyncio.Event(),
    )
    first_event = await anext(generator)
    assert first_event["event"] == "token"
    with pytest.raises(RuntimeError, match="provider disconnected"):
        await anext(generator)

    db_session.expire_all()
    message_result = await db_session.execute(
        select(ChatMessage)
        .where(
            ChatMessage.session_id == session.id,
            ChatMessage.role == "assistant",
        )
        .order_by(ChatMessage.created_at.desc())
    )
    assistant_message = message_result.scalars().first()
    assert assistant_message is not None
    assert assistant_message.content == "partial"
    assert assistant_message.status == MessageStatus.FAILED

