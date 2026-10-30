import asyncio
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


def credentials():
    key = uuid.uuid4().hex
    return {"username": key, "email": f"{key}@example.com", "password": "password123"}


@pytest.mark.asyncio
async def test_username_and_email_matching_different_users(async_client):
    first, second = credentials(), credentials()
    for body in (first, second):
        assert (await async_client.post("/api/auth/register", json=body)).status_code == 201
    response = await async_client.post(
        "/api/auth/register", json={**first, "email": second["email"]}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "该邮箱或用户名已被注册"


@pytest.mark.asyncio
@pytest.mark.parametrize("shared", ["username", "email", "both"])
async def test_conflict_after_both_requests_pass_precheck(
    async_client, db_session, monkeypatch, shared
):
    first, second = credentials(), credentials()
    for field in ("username", "email"):
        if shared in (field, "both"):
            second[field] = first[field]

    execute = AsyncSession.execute
    rollback = AsyncSession.rollback
    ready = asyncio.Event()
    checked_sessions = []
    rolled_back = []

    async def synchronized_execute(session, statement, *args, **kwargs):
        result = await execute(session, statement, *args, **kwargs)
        # Each registration's first execute is its real SQLite precheck.
        if len(checked_sessions) < 2 and session not in checked_sessions:
            checked_sessions.append(session)
            if len(checked_sessions) == 2:
                ready.set()
            await asyncio.wait_for(ready.wait(), timeout=10)
        return result

    async def tracked_rollback(session):
        rolled_back.append(session)
        await rollback(session)

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "execute", synchronized_execute)
        patch.setattr(AsyncSession, "rollback", tracked_rollback)
        responses = await asyncio.wait_for(asyncio.gather(
            async_client.post("/api/auth/register", json=first),
            async_client.post("/api/auth/register", json=second),
        ), timeout=30)

    assert sorted(r.status_code for r in responses) == [201, 409]
    conflict = next(r for r in responses if r.status_code == 409)
    assert conflict.json()["detail"] == "该邮箱或用户名已被注册"
    assert len(checked_sessions) == 2
    assert len(rolled_back) == 1
    assert all("set-cookie" not in r.headers for r in responses)
    count = await db_session.scalar(select(func.count()).select_from(User).where(
        (User.username.in_([first["username"], second["username"]]))
        | (User.email.in_([first["email"], second["email"]]))
    ))
    assert count == 1


@pytest.mark.asyncio
async def test_other_integrity_failure_is_not_reported_as_duplicate(
    async_client, db_session, monkeypatch
):
    body = credentials()
    commit = AsyncSession.commit
    rollback = AsyncSession.rollback
    rolled_back = []

    async def invalid_commit(session):
        # Cause a real NOT NULL violation, unrelated to username/email uniqueness.
        for obj in session.new:
            if isinstance(obj, User):
                obj.username = None
        await commit(session)

    async def tracked_rollback(session):
        rolled_back.append(session)
        await rollback(session)

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", invalid_commit)
        patch.setattr(AsyncSession, "rollback", tracked_rollback)
        response = await async_client.post("/api/auth/register", json=body)

    assert response.status_code == 500
    assert response.json()["detail"] == "认证服务暂不可用，请稍后重试"
    assert len(rolled_back) == 1
    assert await db_session.scalar(select(User.id).where(User.email == body["email"])) is None
