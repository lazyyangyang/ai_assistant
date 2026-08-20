import uuid

import pytest

from app.config import get_settings


@pytest.mark.asyncio
async def test_register_login_and_me(async_client):
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
    assert "access_token" in register_data
    register_cookie = register_resp.headers.get("set-cookie", "").lower()
    assert get_settings().refresh_cookie_name.lower() in register_cookie
    assert "httponly" in register_cookie
    assert "samesite=lax" in register_cookie

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


@pytest.mark.asyncio
async def test_refresh_renews_cookie_and_returns_access_token(async_client):
    email = f"u_{uuid.uuid4().hex}@example.com"
    username = f"user_{uuid.uuid4().hex[:8]}"

    register_resp = await async_client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": "test_password_123"},
    )
    assert register_resp.status_code == 201

    refresh_resp = await async_client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 200
    refresh_data = refresh_resp.json()
    assert refresh_data["token_type"] == "bearer"
    assert refresh_data["access_token"]
    assert "httponly" in refresh_resp.headers.get("set-cookie", "").lower()

    me_resp = await async_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {refresh_data['access_token']}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == email


@pytest.mark.asyncio
async def test_refresh_rejects_access_token_in_cookie(async_client):
    email = f"u_{uuid.uuid4().hex}@example.com"
    register_resp = await async_client.post(
        "/api/auth/register",
        json={
            "username": f"user_{uuid.uuid4().hex[:8]}",
            "email": email,
            "password": "test_password_123",
        },
    )
    access_token = register_resp.json()["access_token"]
    settings = get_settings()
    async_client.cookies.clear()
    async_client.cookies.set(
        settings.refresh_cookie_name,
        access_token,
        path="/api/auth",
    )

    refresh_resp = await async_client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 401


@pytest.mark.asyncio
async def test_logout_clears_refresh_cookie(async_client):
    await async_client.post(
        "/api/auth/register",
        json={
            "username": f"user_{uuid.uuid4().hex[:8]}",
            "email": f"u_{uuid.uuid4().hex}@example.com",
            "password": "test_password_123",
        },
    )

    logout_resp = await async_client.post("/api/auth/logout")
    assert logout_resp.status_code == 204

    refresh_resp = await async_client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 401

