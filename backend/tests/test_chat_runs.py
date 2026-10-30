import uuid
import pytest
from app.config import get_settings


@pytest.mark.asyncio
async def test_run_admission(async_client, monkeypatch):
    monkeypatch.setenv('CHAT_RUNS_ENABLED', 'true')
    name = uuid.uuid4().hex
    credentials = {'email': f'{name}@example.com', 'password': 'password123'}
    await async_client.post('/api/auth/register', json={**credentials, 'username': name})
    login = await async_client.post('/api/auth/login', json=credentials)
    headers = {'Authorization': 'Bearer ' + login.json()['access_token']}
    body = {'client_request_id': name, 'content': 'Python engineer'}
    first = await async_client.post('/api/chat/runs', json=body, headers=headers)
    assert first.status_code == 200, first.text
    run = first.json()
    duplicate = await async_client.post('/api/chat/runs', json=body, headers=headers)
    assert duplicate.json()['id'] == run['id']
    conflict = await async_client.post('/api/chat/runs', json={**body, 'content': 'changed'}, headers=headers)
    assert conflict.status_code == 409
    busy = await async_client.post('/api/chat/runs', json={**body, 'client_request_id': name + '2', 'session_id': run['session_id']}, headers=headers)
    assert busy.status_code == 409
    assert (await async_client.get('/api/chat/runs/' + run['id'])).status_code == 401
    cancelled = await async_client.post('/api/chat/runs/' + run['id'] + '/cancel', headers=headers)
    assert cancelled.json()['status'] == 'cancelled'
    assert (await async_client.post('/api/chat/runs/' + run['id'] + '/cancel', headers=headers)).json()['status'] == 'cancelled'



@pytest.mark.asyncio
@pytest.mark.parametrize('enabled', ['true', 'false'])
async def test_jd_stream_is_retired(async_client, monkeypatch, enabled):
    monkeypatch.setenv('CHAT_RUNS_ENABLED', enabled)
    name = uuid.uuid4().hex
    credentials = {'email': f'{name}@example.com', 'password': 'password123'}
    await async_client.post('/api/auth/register', json={**credentials, 'username': name})
    login = await async_client.post('/api/auth/login', json=credentials)
    response = await async_client.post('/api/chat/stream',
        headers={'Authorization': 'Bearer ' + login.json()['access_token']},
        json={'agent_type': 'jd', 'messages': [{'role': 'user', 'content': 'Python engineer'}]})
    assert response.status_code == 410
