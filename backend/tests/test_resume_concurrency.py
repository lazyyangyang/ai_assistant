import asyncio
import uuid
import pytest


@pytest.mark.asyncio
async def test_concurrent_versions_and_active_selection(async_client):
    key = uuid.uuid4().hex
    credentials = {'email': f'{key}@example.com', 'password': 'password123'}
    await async_client.post('/api/auth/register', json={'username': key, **credentials})
    login = await async_client.post('/api/auth/login', json=credentials)
    headers = {'Authorization': f"Bearer {login.json()['access_token']}"}
    results = await asyncio.gather(*(async_client.post('/api/resumes', headers=headers, json={
        'title': f'version {i}', 'content': 'test resume', 'is_active': True,
    }) for i in range(4)))
    assert all(r.status_code == 201 for r in results)
    rows = (await async_client.get('/api/resumes', headers=headers)).json()
    assert len({r['version'] for r in rows}) == 4
    assert sum(r['is_active'] for r in rows) == 1
    results = await asyncio.gather(*(async_client.patch(f"/api/resumes/{r['id']}", headers=headers,
                                                       json={'is_active': True}) for r in rows))
    assert all(r.status_code == 200 for r in results)
    rows = (await async_client.get('/api/resumes', headers=headers)).json()
    assert sum(r['is_active'] for r in rows) == 1
