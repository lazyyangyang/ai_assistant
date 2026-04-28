import uuid

import pytest


@pytest.mark.asyncio
async def test_transcribe_requires_auth(async_client):
    resp = await async_client.post(
        "/api/stt/transcribe",
        data={"language": "zh"},
        files={"file": ("audio.webm", b"dummy-audio-bytes", "audio/webm")},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_transcribe_success_returns_text(async_client, monkeypatch):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "test_password_123"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert register_resp.status_code == 201
    token = register_resp.json()["access_token"]

    import app.routers.stt as stt_router

    async def fake_transcribe(*, audio_bytes, filename, content_type, language):
        return "你好，欢迎参加面试。"

    monkeypatch.setattr(stt_router, "_transcribe_via_openai_compat", fake_transcribe)

    resp = await async_client.post(
        "/api/stt/transcribe",
        data={"language": "zh"},
        files={"file": ("audio.webm", b"dummy-audio-bytes", "audio/webm")},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    assert resp.json()["text"] == "你好，欢迎参加面试。"

