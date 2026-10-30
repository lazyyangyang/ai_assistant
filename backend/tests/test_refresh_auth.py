import asyncio
import time
import uuid

import pytest
from jose import jwt
from sqlalchemy import select

from app.auth import decode_access_claims
from app.config import get_settings
from app.models.auth_session import AuthSession


async def register_and_login(client):
    key = uuid.uuid4().hex
    response = await client.post('/api/auth/register', json={
        'username': key, 'email': f'{key}@example.com', 'password': 'password123',
    })
    assert response.status_code == 201
    login_response = await client.post('/api/auth/login', json={
        'email': f'{key}@example.com', 'password': 'password123',
    })
    assert login_response.status_code == 200
    return login_response


@pytest.mark.asyncio
async def test_cookie_hash_refresh_and_immediate_logout_revocation(async_client, db_session):
    response = await register_and_login(async_client)
    cookie = response.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'SameSite=strict' in cookie and 'Path=/api/auth' in cookie
    assert response.headers['cache-control'] == 'no-store'
    assert 'refresh_token' not in response.json()
    sid = response.json()['session_id']
    token = response.json()['access_token']
    claims = decode_access_claims(token)
    session = await db_session.get(AuthSession, claims['sid'])
    raw_refresh = async_client.cookies.get('ai_career_tab_refresh')
    assert session.refresh_hash != raw_refresh and len(session.refresh_hash) == 64
    refreshed = await async_client.post(f'/api/auth/sessions/{sid}/refresh')
    assert refreshed.status_code == 200
    assert refreshed.json()['access_token'] != token
    assert decode_access_claims(refreshed.json()['access_token'])['sid'] == session.id
    # Refresh has a fixed deadline and does not mutate/extend the cookie.
    assert 'set-cookie' not in refreshed.headers
    assert (await async_client.post(f'/api/auth/sessions/{sid}/logout')).status_code == 204
    assert async_client.cookies.get('ai_career_tab_refresh') is None
    assert (await async_client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})).status_code == 401
    assert (await async_client.post(f'/api/auth/sessions/{sid}/refresh')).status_code == 401
    async_client.cookies.set('ai_career_tab_refresh', raw_refresh, path=f'/api/auth/sessions/{sid}/')
    assert (await async_client.post(f'/api/auth/sessions/{sid}/refresh')).status_code == 401


@pytest.mark.asyncio
async def test_concurrent_refreshes_do_not_invalidate_cookie(async_client):
    sid = (await register_and_login(async_client)).json()['session_id']
    results = await asyncio.gather(*(async_client.post(f'/api/auth/sessions/{sid}/refresh') for _ in range(8)))
    assert all(result.status_code == 200 for result in results)
    sessions = {decode_access_claims(result.json()['access_token'])['sid'] for result in results}
    assert len(sessions) == 1


@pytest.mark.asyncio
async def test_expired_session_and_missing_or_tampered_cookie(async_client, db_session):
    sid = '0' * 32
    assert (await async_client.post(f'/api/auth/sessions/{sid}/refresh')).status_code == 401
    result = await register_and_login(async_client)
    sid = result.json()['session_id']
    claims = decode_access_claims(result.json()['access_token'])
    session = await db_session.get(AuthSession, claims['sid'])
    session.expires_at = int(time.time()) - 1
    await db_session.commit()
    assert (await async_client.post(f'/api/auth/sessions/{sid}/refresh')).status_code == 401
    assert (await async_client.get('/api/auth/me', headers={
        'Authorization': f"Bearer {result.json()['access_token']}"
    })).status_code == 401
    async_client.cookies.clear()
    async_client.cookies.set('ai_career_tab_refresh', 'tampered', path=f'/api/auth/sessions/{sid}/')
    assert (await async_client.post(f'/api/auth/sessions/{sid}/refresh')).status_code == 401


@pytest.mark.asyncio
async def test_csrf_origin_and_secure_cookie(async_client, monkeypatch):
    monkeypatch.setenv('REFRESH_COOKIE_SECURE', 'true')
    result = await register_and_login(async_client)
    assert 'Secure' in result.headers['set-cookie']
    sid = result.json()['session_id']
    for path in (f'sessions/{sid}/refresh', f'sessions/{sid}/logout', 'login', 'register'):
        response = await async_client.post(f'/api/auth/{path}', headers={'X-CSRF-Protection': ''}, json={})
        assert response.status_code == 403
        response = await async_client.post(f'/api/auth/{path}', headers={'Origin': 'https://attacker.example'}, json={})
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_expired_access_refreshes_but_wrong_token_type_is_rejected(async_client):
    response = await register_and_login(async_client)
    sid = response.json()['session_id']
    claims = decode_access_claims(response.json()['access_token'])
    settings = get_settings()
    for changed in ({**claims, 'exp': int(time.time()) - 1}, {**claims, 'type': 'refresh'}):
        invalid = jwt.encode(changed, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        assert (await async_client.get('/api/auth/me', headers={'Authorization': f'Bearer {invalid}'})).status_code == 401
    assert (await async_client.post(f'/api/auth/sessions/{sid}/refresh')).status_code == 200


@pytest.mark.asyncio
async def test_new_login_preserves_other_cookie_session(async_client, db_session):
    response = await register_and_login(async_client)
    old_token = response.json()['access_token']
    old_claims = decode_access_claims(old_token)
    await register_and_login(async_client)
    assert (await db_session.execute(select(AuthSession).where(AuthSession.id == old_claims['sid']))).scalar_one_or_none() is not None
    assert (await async_client.get('/api/auth/me', headers={'Authorization': f'Bearer {old_token}'})).status_code == 200


@pytest.mark.asyncio
async def test_targeted_cookie_mismatch_and_idempotence(async_client):
    first = await register_and_login(async_client)
    second = await register_and_login(async_client)
    a, b = first.json()['session_id'], second.json()['session_id']
    cookies = {c.path: c.value for c in async_client.cookies.jar}
    assert len(cookies) == 2
    assert f'/api/auth/sessions/{a}/' in cookies
    assert f'/api/auth/sessions/{b}/' in cookies
    async_client.cookies.clear()
    async_client.cookies.set('ai_career_tab_refresh', cookies[f'/api/auth/sessions/{b}/'], path=f'/api/auth/sessions/{a}/')
    for action in ('refresh', 'logout'):
        r = await async_client.post(f'/api/auth/sessions/{a}/{action}')
        assert r.status_code == 401 and r.headers['cache-control'] == 'no-store'
    async_client.cookies.clear()
    async_client.cookies.set('ai_career_tab_refresh', cookies[f'/api/auth/sessions/{a}/'], path=f'/api/auth/sessions/{a}/')
    assert (await async_client.post(f'/api/auth/sessions/{a}/logout')).status_code == 204
    assert (await async_client.post(f'/api/auth/sessions/{a}/logout')).status_code == 204
    assert (await async_client.get('/api/auth/me', headers={'Authorization': f"Bearer {second.json()['access_token']}"})).status_code == 200
    for action in ('refresh', 'logout'):
        assert (await async_client.post(f'/api/auth/{action}')).status_code == 410
        assert (await async_client.post(f'/api/auth/sessions/invalid/{action}')).status_code == 422

@pytest.mark.asyncio
async def test_logout_commit_failure_is_not_success(async_client, monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.main import app
    response = await register_and_login(async_client)
    sid = response.json()['session_id']
    async def fail_commit(self):
        raise RuntimeError('injected commit failure')
    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, 'commit', fail_commit)
        async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False),
                               base_url='http://test', cookies=async_client.cookies) as client:
            result = await client.post(f'/api/auth/sessions/{sid}/logout', headers={'X-CSRF-Protection': '1'})
        assert result.status_code == 500
        assert result.headers['cache-control'] == 'no-store'
        assert 'set-cookie' not in result.headers
    assert (await async_client.post(f'/api/auth/sessions/{sid}/refresh')).status_code == 200
