import uuid

import pytest


@pytest.mark.asyncio
async def test_tts_requires_auth(async_client):
    resp = await async_client.post("/api/tts/synthesize", json={"text": "你好"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_tts_success_returns_audio(async_client, monkeypatch):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "test_password_123"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert register_resp.status_code == 201
    login_resp = await async_client.post(
        "/api/auth/login", json={"email": email, "password": password},
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]

    import app.routers.tts as tts_router

    async def fake_synthesize_via_openai_compat(*, text, voice, model, response_format):
        return b"fake-audio-bytes", "audio/mpeg"

    monkeypatch.setattr(
        tts_router,
        "_synthesize_via_openai_compat",
        fake_synthesize_via_openai_compat,
    )

    resp = await async_client.post(
        "/api/tts/synthesize",
        json={"text": "你好，面试开始吧！"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/")
    assert resp.content == b"fake-audio-bytes"

