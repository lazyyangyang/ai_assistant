"""Real Redis integration probe; only creates unique disposable test data.
Run from backend: .venv/Scripts/python scripts/verify_redis_concurrency.py --redis-server PATH
Model calls are deterministic substitutes. API auth is overridden for admission races.
"""
import argparse
import asyncio
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--redis-server', required=True)
parser.add_argument('--faults-only', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
folder = root / '.local' / 'redis-validation' / uuid.uuid4().hex
folder.mkdir(parents=True)
sys.path.insert(0, str(root / 'backend'))
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
os.environ.update(DATABASE_URL='sqlite+aiosqlite:///' + (folder / 'test.db').as_posix(),
                  REDIS_URL=f'redis://127.0.0.1:{port}/0', RUN_ENVIRONMENT='verification-' + folder.name,
                  CHAT_RUNS_ENABLED='true', OPENAI_API_KEY='no-real-model', OPENAI_BASE_URL='http://127.0.0.1:1',
                  RUN_SNAPSHOT_SECONDS='2', CHAT_RUNS_CAPACITY='100', CHAT_RUNS_PER_USER='3')

from redis.asyncio import Redis
from sqlalchemy import select, event
from httpx import ASGITransport, AsyncClient
from app import worker
from app.database import engine, async_session_factory
from app.models import Base, User, ChatSession, ChatMessage, ChatRun
from app.models.chat import AgentType
from app.main import app
from app.deps import get_current_user
from app.services.run_events import RunEvents

report = {'database': str(folder / 'test.db'), 'model': 'deterministic 220 chunks, 20ms/chunk',
          'scenarios': [], 'checks': {}}


async def seed(count):
    ids = []
    async with async_session_factory() as db:
        for _ in range(count):
            name = uuid.uuid4().hex
            user = User(username=name, email=name+'@example.com')
            db.add(user)
            await db.flush()
            session = ChatSession(user_id=user.id, agent_type=AgentType.JD)
            db.add(session)
            await db.flush()
            question = ChatMessage(session_id=session.id, role='user', content=name)
            answer = ChatMessage(session_id=session.id, role='assistant', content='')
            db.add_all([question, answer])
            await db.flush()
            run = ChatRun(user_id=user.id, session_id=session.id, client_request_id=name,
                request_hash=name, input_json=json.dumps({'request': {'content': name, 'mode': 'new'}, 'history': [], 'jd_context': None}),
                user_message_id=question.id, assistant_message_id=answer.id)
            db.add(run)
            await db.flush()
            ids.append(run.id)
        await db.commit()
    return ids


async def admission():
    async with async_session_factory() as db:
        name = uuid.uuid4().hex
        user = User(username=name, email=name+'@example.com')
        db.add(user)
        await db.commit()
    app.dependency_overrides[get_current_user] = lambda: user
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        body = {'client_request_id': uuid.uuid4().hex, 'content': '并发 JD'}
        results = await asyncio.gather(*(client.post('/api/chat/runs', json=body) for _ in range(16)))
        assert all(r.status_code == 200 for r in results), [r.text for r in results]
        assert len({r.json()['id'] for r in results}) == 1
        first = results[0].json()
        await client.post(f"/api/chat/runs/{first['id']}/cancel")
        bodies = [{**body, 'client_request_id': uuid.uuid4().hex, 'session_id': first['session_id']} for _ in range(8)]
        results = await asyncio.gather(*(client.post('/api/chat/runs', json=b) for b in bodies))
        counts = Counter(r.status_code for r in results)
        assert counts == {200: 1, 409: 7}, counts
        for r in results:
            if r.status_code == 200:
                await client.post(f"/api/chat/runs/{r.json()['id']}/cancel")
        results = await asyncio.gather(*(client.post('/api/chat/runs', json={**body, 'client_request_id': uuid.uuid4().hex}) for _ in range(8)))
        counts = Counter(r.status_code for r in results)
        assert counts == {200: 3, 429: 5}, counts
        for r in results:
            if r.status_code == 200:
                await client.post(f"/api/chat/runs/{r.json()['id']}/cancel")
    app.dependency_overrides.clear()
    report['checks']['admission'] = '16 identical -> 1 run; same session 8 -> 1 admitted; user quota 8 -> 3 admitted'


async def scenario(concurrency, events):
    ids = await seed(12)
    progress = defaultdict(list)
    claims = []
    times = {}
    locks = []
    commits = [0]
    active = [0, 0]
    original_persist = worker.persist
    def committed(conn):
        commits[0] += 1
    def db_error(context):
        if 'locked' in str(context.original_exception).lower(): locks.append(str(context.original_exception))
    event.listen(engine.sync_engine, 'commit', committed)
    event.listen(engine.sync_engine, 'handle_error', db_error)
    async def tracked(run, status=None, error=None):
        await original_persist(run, status, error)
        previous = progress[run.id]
        assert not previous or run.result_text.startswith(previous[-1]), 'snapshot regressed'
        previous.append(run.result_text)
    async def model(*args, **kwargs):
        for i in range(220):
            await asyncio.sleep(.02)
            yield f'片段{i:03d}中🙂|'
    async def extract(*args, **kwargs):
        return {'summary': 'fixed', 'skills': [], 'responsibilities': [], 'hard_requirements': []}
    worker.persist, worker.stream_agent_response, worker.extract_jd_structured = tracked, model, extract
    expected = ''.join(f'片段{i:03d}中🙂|' for i in range(220))
    stop = asyncio.Event()
    observation_count = 0
    async def observer():
        nonlocal observation_count
        previous = {}
        while not stop.is_set():
            async with async_session_factory() as db:
                records = (await db.scalars(select(ChatRun).where(ChatRun.id.in_(ids)))).all()
            for run in records:
                assert expected.startswith(run.result_text)
                assert run.result_text.startswith(previous.get(run.id, ''))
                previous[run.id] = run.result_text
                snapshot = await events.snapshot(run.id)
                if snapshot:
                    state, cursor = snapshot
                    assert expected.startswith(state['result_text'])
                    entry = await events.redis.xrange(events.keys(run.id)[1], min=cursor, max=cursor)
                    assert len(entry) == 1, 'snapshot cursor absent from stream'
                    if state['status'] == 'succeeded':
                        async with async_session_factory() as db:
                            assert (await db.get(ChatRun, run.id)).status == 'succeeded'
                    observation_count += 1
            await asyncio.sleep(.1)
    async def consumer(index):
        while True:
            run = await worker.claim(f'probe-{index}')
            if run is None: return
            assert run.id in ids
            claims.append(run.id)
            active[0] += 1
            active[1] = max(active)
            start = time.perf_counter()
            try:
                await worker.execute(run, events)
            finally:
                active[0] -= 1
                times[run.id] = time.perf_counter() - start
    started = time.perf_counter()
    observer_task = asyncio.create_task(observer())
    try:
        await asyncio.gather(*(consumer(i) for i in range(concurrency)))
    finally:
        stop.set()
        await observer_task
        worker.persist = original_persist
        event.remove(engine.sync_engine, 'commit', committed)
        event.remove(engine.sync_engine, 'handle_error', db_error)
    assert len(claims) == len(set(claims)) == 12
    event_counts = []
    async with async_session_factory() as db:
        for run_id in ids:
            run = await db.get(ChatRun, run_id)
            assert run.status == 'succeeded', (run.status, run.error_code)
            assert run.result_text == expected
            assert (await db.get(ChatMessage, run.assistant_message_id)).content == expected
            stream = await events.redis.xrange(events.keys(run_id)[1])
            reconstructed = ''.join(json.loads(fields['data'])['content'] for _, fields in stream if fields['event'] == 'token')
            assert reconstructed == expected, 'token replay differs'
            middle = len(stream) // 2
            replay = await events.read(run_id, stream[middle][0])
            assert replay[0][1] == stream[middle+1:], 'reconnect replay differs'
            snapshot, cursor = await events.snapshot(run_id)
            assert snapshot['result_text'] == expected and cursor == stream[-1][0]
            assert await events.redis.ttl(events.keys(run_id)[0]) > 0
            event_counts.append(len(stream))
    report['scenarios'].append({'concurrency': concurrency, 'tasks': 12, 'peak_active': active[1],
        'elapsed_seconds': round(time.perf_counter()-started, 3), 'mean_run_seconds': round(sum(times.values())/12, 3),
        'sqlite_commits_including_claims': commits[0], 'snapshot_saves': sum(map(len, progress.values())),
        'snapshots_per_run': [len(progress[r]) for r in ids], 'redis_events': sum(event_counts),
        'observations': observation_count, 'sqlite_lock_errors': len(locks), 'unique_claims': len(set(claims)),
        'text_exact_match': True, 'replay_exact_match': True, 'snapshots_monotonic': True})
    print(json.dumps(report['scenarios'][-1]), flush=True)


async def main():
    events = RunEvents()
    try:
        for _ in range(60):
            try:
                await events.redis.ping()
                break
            except Exception:
                await asyncio.sleep(.2)
        else:
            raise RuntimeError('Redis failed to start; inspect server.log')
        info = await events.redis.info('server')
        report['redis_version'] = info['redis_version']
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await admission()
        for concurrency in (() if args.faults_only else (2, 4, 8)):
            await scenario(concurrency, events)
        # Redis attempt fence, stream trimming and cursor consistency using real Lua.
        from types import SimpleNamespace
        run = SimpleNamespace(id=uuid.uuid4().hex, session_id='probe', assistant_message_id='a', attempt=2,
            status='running', phase='analysis', result_text='', structured_json=None, error_code=None, cancel_requested=False)
        events.settings.run_event_limit = 100
        for i in range(120):
            run.result_text += '字'
            await events.publish(run, 'token', {'content': '字'})
        before = await events.snapshot(run.id)
        assert await events.redis.xlen(events.keys(run.id)[1]) == 100
        assert await events.redis.ttl(events.keys(run.id)[0]) == -1
        run.attempt = 1
        assert await events.publish(run, 'token', {'content': '旧'}) is None
        assert await events.snapshot(run.id) == before
        report['checks']['redis'] = 'attempt fence, exact stream cap, active no TTL, terminal TTL passed'
        async def slow_model(*args, **kwargs):
            for i in range(300):
                await asyncio.sleep(.02)
                yield f'测试{i}|'
        async def fixed_extract(*args, **kwargs):
            return {'summary': 'fixed', 'skills': [], 'responsibilities': [], 'hard_requirements': []}
        worker.stream_agent_response = slow_model
        worker.extract_jd_structured = fixed_extract
        await seed(1)
        run = await worker.claim('cancel-probe')
        execution = asyncio.create_task(worker.execute(run, events))
        await asyncio.sleep(.4)
        cancel_start = time.perf_counter()
        async with async_session_factory() as db:
            from sqlalchemy import text
            await db.execute(text('BEGIN IMMEDIATE'))
            saved = await db.get(ChatRun, run.id)
            saved.cancel_requested = True
            await db.commit()
        await asyncio.wait_for(execution, timeout=15)
        async with async_session_factory() as db:
            saved = await db.get(ChatRun, run.id)
            assert saved.status == 'cancelled' and saved.result_text
        stream = await events.redis.xrange(events.keys(run.id)[1])
        assert not any(fields['event'] == 'completed' for _, fields in stream)
        report['checks']['cancel_seconds'] = round(time.perf_counter() - cancel_start, 3)
        await seed(1)
        run = await worker.claim('outage-probe')
        execution = asyncio.create_task(worker.execute(run, events))
        await asyncio.sleep(.4)
        outage_start = time.perf_counter()
        await events.redis.shutdown(nosave=True)
        await asyncio.wait_for(execution, timeout=25)
        async with async_session_factory() as db:
            saved = await db.get(ChatRun, run.id)
            assert saved.status == 'failed' and saved.result_text
            assert (await db.get(ChatMessage, saved.assistant_message_id)).content == saved.result_text
            report['checks']['redis_outage'] = {'status': saved.status, 'error_code': saved.error_code,
                'partial_characters_saved': len(saved.result_text), 'settled_seconds': round(time.perf_counter() - outage_start, 3)}
        report['passed'] = True
    finally:
        (folder / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        try: await events.redis.shutdown(nosave=True)
        except Exception: pass
        await events.close()
        await engine.dispose()
        print('REPORT=' + str(folder / 'report.json'), flush=True)


log = (folder / 'server.log').open('wb')
process = subprocess.Popen([str(Path(args.redis_server).resolve()), '--bind', '127.0.0.1', '--port', str(port),
    '--protected-mode', 'yes', '--appendonly', 'yes', '--appendfsync', 'everysec', '--save', '',
    '--maxmemory', '128mb', '--maxmemory-policy', 'noeviction', '--dir', '.'],
    cwd=folder, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
try:
    asyncio.run(main())
finally:
    if process.poll() is None:
        process.terminate()
    process.wait(timeout=10)
    log.close()
