import json
import uuid

import pytest
from sqlalchemy import select

from app.models.chat import ChatSession, SessionStatus
from app.auth import decode_access_token


@pytest.mark.asyncio
async def test_interview_end_sets_feedback_and_completed(async_client, db_session, monkeypatch):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "test_password_123"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert register_resp.status_code == 201
    token = register_resp.json()["access_token"]

    import app.routers.chat as chat_router

    fake_feedback = {
        "overallScore": 8,
        "overallSummary": "表达清晰，技术深度尚可，但与 JD 的对应还可以更具体。",
        "aspects": [
            {"name": "表达清晰度", "score": 8, "reason": "结构化表达，逻辑连贯。"},
            {"name": "技术深度", "score": 7, "reason": "覆盖主要点，但缺少关键细节。"},
        ],
        "improvements": [
            {"title": "补充关键细节", "detail": "加入关键实现步骤、数据结构或权衡点。", "priority": "high"},
            {"title": "更贴合 JD", "detail": "将回答映射到 JD 的硬性能力与职责。", "priority": "medium"},
        ],
    }

    async def fake_extract_interview_feedback(*, history, resume_context=None, jd_context=None):
        return fake_feedback

    monkeypatch.setattr(chat_router, "extract_interview_feedback", fake_extract_interview_feedback)

    resp = await async_client.post(
        "/api/chat/stream",
        json={"agent_type": "interview", "messages": [{"role": "user", "content": "结束面试"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200

    session_id = resp.headers.get("X-Session-Id") or resp.headers.get("x-session-id")
    assert session_id

    session_result = await db_session.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = session_result.scalar_one_or_none()
    assert session is not None
    assert session.status == SessionStatus.COMPLETED
    assert session.feedback is not None

    parsed = json.loads(session.feedback)
    assert parsed["overallScore"] == 8


@pytest.mark.asyncio
async def test_interview_llm_history_loaded_from_db(async_client, db_session, monkeypatch):
    # 1) Create a session with first user message.
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

    import app.routers.chat as chat_router

    calls: list[list[dict[str, str]]] = []

    async def fake_stream_agent_response(agent_type, history, resume_context=None, jd_context=None):
        calls.append(history)
        yield "ASSISTANT_1"

    monkeypatch.setattr(chat_router, "stream_agent_response", fake_stream_agent_response)

    resp1 = await async_client.post(
        "/api/chat/stream",
        json={"agent_type": "interview", "messages": [{"role": "user", "content": "A"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp1.status_code == 200
    session_id = resp1.headers.get("X-Session-Id") or resp1.headers.get("x-session-id")
    assert session_id

    # 2) Call again with session_id, but only send the latest user message in request payload.
    #    Server should load full history from DB instead.
    resp2 = await async_client.post(
        "/api/chat/stream",
        json={"agent_type": "interview", "session_id": session_id, "messages": [{"role": "user", "content": "B"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp2.status_code == 200

    assert len(calls) >= 2
    assert calls[0] == [{"role": "user", "content": "A"}]
    assert calls[1] == [
        {"role": "user", "content": "A"},
        {"role": "assistant", "content": "ASSISTANT_1"},
        {"role": "user", "content": "B"},
    ]

