import uuid

import pytest


@pytest.mark.asyncio
async def test_register_login_and_me(async_client, db_session):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "test_password_123"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
        },
    )
    assert register_resp.status_code == 201
    register_data = register_resp.json()
    assert register_data["email"] == email
    assert register_data["username"] == username
    assert "access_token" not in register_data
    assert "hashed_password" not in register_data
    assert "set-cookie" not in register_resp.headers
    from sqlalchemy import select
    from app.models.auth_session import AuthSession
    sessions = await db_session.execute(select(AuthSession).where(AuthSession.user_id == register_data["id"]))
    assert sessions.scalars().all() == []
    assert (await async_client.post('/api/auth/refresh')).status_code == 410
    assert (await async_client.get('/api/auth/me')).status_code == 401

    login_resp = await async_client.post(
        "/api/auth/login",
        json={
            "email": email,
            "password": password,
        },
    )
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    assert "access_token" in login_data

    me_resp = await async_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {login_data['access_token']}"},
    )
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["email"] == email
    assert me_data["username"] == username


@pytest.mark.asyncio
async def test_me_requires_valid_token(async_client):
    me_resp = await async_client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer invalid.token"},
    )
    assert me_resp.status_code == 401


@pytest.mark.asyncio
async def test_register_conflict_on_email_or_username(async_client):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "test_password_123"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert register_resp.status_code == 201

    # Conflict by email.
    resp_email_conflict = await async_client.post(
        "/api/auth/register",
        json={
            "username": f"{username}_other",
            "email": email,
            "password": password,
        },
    )
    assert resp_email_conflict.status_code == 409
    assert resp_email_conflict.json()["detail"] == "该邮箱或用户名已被注册"

    # Conflict by username.
    resp_username_conflict = await async_client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": f"u_{uuid.uuid4().hex}@example.com",
            "password": password,
        },
    )
    assert resp_username_conflict.status_code == 409


@pytest.mark.asyncio
async def test_login_rejects_wrong_password(async_client):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"
    password = "test_password_123"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert register_resp.status_code == 201

    login_resp = await async_client.post(
        "/api/auth/login",
        json={"email": email, "password": f"{password}_wrong"},
    )
    assert login_resp.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_authorization_header(async_client):
    me_resp = await async_client.get("/api/auth/me")
    assert me_resp.status_code == 401

