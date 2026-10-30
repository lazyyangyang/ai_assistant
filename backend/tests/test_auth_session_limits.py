import asyncio
import time
import uuid

import pytest
from sqlalchemy import func, select
from app.models.auth_session import AuthSession


@pytest.mark.asyncio
async def test_concurrent_admission_expiry_and_recovery(async_client, db_session, monkeypatch):
    monkeypatch.setenv('AUTH_MAX_ACTIVE_SESSIONS_PER_USER', '3')
    key = uuid.uuid4().hex
    credentials = {'email': f'{key}@example.com', 'password': 'password123'}
    user = (await async_client.post('/api/auth/register', json={'username': key, **credentials})).json()
    first = await async_client.post('/api/auth/login', json=credentials)
    assert first.status_code == 200
    results = await asyncio.gather(*(async_client.post('/api/auth/login', json=credentials) for _ in range(8)))
    assert all(r.status_code in (200, 409, 503) for r in results)
    assert sum(r.status_code == 200 for r in results) <= 2
    count = await db_session.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.user_id == user['id']))
    assert count <= 3
    await db_session.rollback()
    for _ in range(3 - count):
        assert (await async_client.post('/api/auth/login', json=credentials)).status_code == 200
    assert (await async_client.post('/api/auth/login', json=credentials)).status_code == 409
    session = await db_session.get(AuthSession, first.json()['session_id'])
    session.expires_at = int(time.time()) - 1
    await db_session.commit()
    assert (await async_client.post('/api/auth/login', json=credentials)).status_code == 200
    assert (await async_client.post('/api/auth/login', json=credentials)).status_code == 409

@pytest.mark.asyncio
async def test_lock_conflict_then_success(async_client):
    from sqlalchemy import text
    from app.database import engine
    key = uuid.uuid4().hex
    credentials = {'email': f'{key}@example.com', 'password': 'password123'}
    await async_client.post('/api/auth/register', json={'username': key, **credentials})
    async with engine.connect() as lock:
        await lock.execute(text('BEGIN IMMEDIATE'))
        response = await async_client.post('/api/auth/login', json=credentials)
        assert response.status_code == 503
        assert 'set-cookie' not in response.headers
        await lock.rollback()
    assert (await async_client.post('/api/auth/login', json=credentials)).status_code == 200
