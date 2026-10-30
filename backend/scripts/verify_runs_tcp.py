"""Isolated real TCP/API + Redis + independent worker process integration test.
Uses synthetic models only. Run with --redis-server PATH. Artifacts in .local.
"""
import argparse, asyncio, json, math, os, socket, subprocess, sys, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
parser = argparse.ArgumentParser()
parser.add_argument('--role', choices=['api', 'worker'])
parser.add_argument('--port', type=int)
parser.add_argument('--redis-server')
parser.add_argument('--trace-pool', action='store_true')
parser.add_argument('--levels', type=int, nargs='+', default=[1, 5, 10, 20, 40])
parser.add_argument('--waves', type=int, default=3)
args = parser.parse_args()
TEXT = '岗位分析：需要 React 与 TypeScript 技能。\n'
EXPECTED = TEXT * 40
STRUCT = dict(skills=['React', 'TypeScript'], responsibilities=['页面开发'], hard_requirements=['本科'], summary='前端')


def trace_pool():
    from sqlalchemy import event
    from app.database import engine
    import traceback
    active = {}
    output = Path(os.environ['POOL_TRACE_DIR']) / f'pool-{args.role}-{os.getpid()}.jsonl'
    def write(kind, record, **fields):
        with output.open('a', encoding='utf-8') as f:
            f.write(json.dumps(dict(event=kind, connection=id(record), time=time.monotonic(),
                                    active=len(active), **fields)) + '\n')
    @event.listens_for(engine.sync_engine, 'checkout')
    def checkout(connection, record, proxy):
        active[id(record)] = time.monotonic()
        frames = []
        coro = asyncio.current_task().get_coro()
        while coro is not None:
            frame = getattr(coro, 'cr_frame', None) or getattr(coro, 'gi_frame', None)
            if frame:
                frames.append(f'{frame.f_code.co_filename}:{frame.f_lineno}:{frame.f_code.co_name}')
            coro = getattr(coro, 'cr_await', None) or getattr(coro, 'gi_yieldfrom', None)
        write('checkout', record, stack=frames)
    @event.listens_for(engine.sync_engine, 'before_cursor_execute')
    def sql(connection, cursor, statement, parameters, context, many):
        record = connection.connection._connection_record
        write('sql', record, statement=statement.split()[0], table=statement[:150])
    @event.listens_for(engine.sync_engine, 'checkin')
    def checkin(connection, record):
        start = active.pop(id(record), None)
        write('checkin', record, held_ms=(time.monotonic()-start)*1000 if start else None)


def child():
    if os.environ.get('POOL_TRACE_DIR'):
        trace_pool()
    if args.role == 'api':
        import uvicorn
        uvicorn.run('app.main:app', host='127.0.0.1', port=args.port, log_level='warning', access_log=False)
    else:
        from app import worker
        async def model(*a, **kw):
            await asyncio.sleep(.1)
            for _ in range(40):
                await asyncio.sleep(.025)
                yield TEXT
        async def extract(*a, **kw):
            await asyncio.sleep(.2)
            return STRUCT.copy()
        worker.stream_agent_response, worker.extract_jd_structured = model, extract
        asyncio.run(worker.main())


def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


async def test(folder, api_port, processes, spawn):
    import httpx
    from redis.asyncio import Redis
    from app.database import engine
    from app.models import Base
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    await engine.dispose()
    redis = Redis.from_url(os.environ['REDIS_URL'])
    for _ in range(100):
        try:
            await redis.ping()
            break
        except Exception:
            await asyncio.sleep(.1)
    else:
        raise RuntimeError('Redis startup failed')
    spawn('api', '--role', 'api', '--port', str(api_port))
    worker_process = spawn('worker', '--role', 'worker')
    rows, checks, summaries = [], {}, []
    report = {'batch': folder.name, 'worker_slots': 8, 'model': '40 chunks at 25ms + 100ms initial + 200ms extraction',
              'separate_processes': True, 'levels': args.levels, 'waves': args.waves, 'stream_deadline_seconds': 25, 'requests': rows, 'checks': checks, 'summaries': summaries}
    try:
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{api_port}', trust_env=False,
                timeout=90, limits=httpx.Limits(max_connections=100), headers={'X-CSRF-Protection': '1'}) as c:
            for _ in range(100):
                try:
                    (await c.get('/api/health')).raise_for_status()
                    break
                except Exception:
                    await asyncio.sleep(.1)
            tokens = []
            for i in range(max(2, max(args.levels))):
                body = dict(username=f'lt_{i}', email=f'lt_{i}@example.com', password='isolated-test-123')
                (await c.post('/api/auth/register', json=body)).raise_for_status()
                response = await c.post('/api/auth/login', json=body)
                response.raise_for_status()
                tokens.append({'Authorization': 'Bearer '+response.json()['access_token']})

            async def submit(i=0):
                body = dict(client_request_id=uuid.uuid4().hex, content='前端工程师，React、TypeScript，本科，负责页面开发。')
                r = await c.post('/api/chat/runs', json=body, headers=tokens[i])
                r.raise_for_status()
                return r.json(), body

            async def watch(run, i=0, stop_early=False):
                start = time.perf_counter()
                content, cursor, first, terminal = '', '0-0', None, None
                async with c.stream('GET', f"/api/chat/runs/{run['id']}/events", headers=tokens[i]) as r:
                    r.raise_for_status()
                    event, eid = '', None
                    async for line in r.aiter_lines():
                        if line.startswith('event:'): event = line[6:].strip()
                        elif line.startswith('id:'): eid = line[3:].strip()
                        elif line.startswith('data:'):
                            data = json.loads(line[5:])
                            if event == 'snapshot': content = data['result_text']
                            elif event == 'token': content += data['content']
                            if content and first is None: first = (time.perf_counter()-start)*1000
                            if eid: cursor = eid
                            if stop_early and content: break
                            if event in ['completed', 'failed', 'cancelled', 'interrupted', 'unavailable']:
                                terminal = event
                                break
                return dict(content=content, cursor=cursor, first_ms=first, terminal=terminal)

            async def get(run, i=0):
                r = await c.get(f"/api/chat/runs/{run['id']}", headers=tokens[i])
                r.raise_for_status()
                return r.json()

            async def one(i, level, wave):
                start = time.perf_counter()
                row = dict(concurrency=level, wave=wave, success=False)
                try:
                    run, body = await submit(i)
                    row.update(id=run['id'], client_request_id=body['client_request_id'])
                    admitted = time.perf_counter()
                    observed = await asyncio.wait_for(watch(run, i), timeout=25)
                    saved = await get(run, i)
                    row.update(status=saved['status'], terminal=observed['terminal'],
                        text_match=saved['result_text']==EXPECTED, stream_match=observed['content']==EXPECTED,
                        structured_match=json.loads(saved['structured_json'] or '{}')==STRUCT,
                        ttft_ms=(admitted-start)*1000 + (observed['first_ms'] or 0),
                        success=saved['status']=='succeeded' and saved['result_text']==EXPECTED
                        and observed['content']==EXPECTED and json.loads(saved['structured_json'] or '{}')==STRUCT)
                except Exception as e:
                    row['error'] = type(e).__name__ + ': ' + str(e)
                row['elapsed_ms'] = (time.perf_counter()-start)*1000
                rows.append(row)

            await one(0, 1, 'warmup')
            for level in args.levels:
                begin = time.perf_counter()
                for wave in range(args.waves):
                    await asyncio.gather(*(one(i, level, wave) for i in range(level)))
                    if worker_process.poll() is not None:
                        raise RuntimeError('Worker exited unexpectedly; capacity sweep aborted')
                batch = [r for r in rows if r['concurrency']==level and isinstance(r['wave'], int)]
                def p95(key):
                    data = sorted(r[key] for r in batch if key in r)
                    return round(data[math.ceil(len(data)*.95)-1], 2) if data else None
                summaries.append(dict(concurrency=level, count=len(batch), success=sum(r['success'] for r in batch),
                    elapsed_p95_ms=p95('elapsed_ms'), ttft_p95_ms=p95('ttft_ms'), wall_seconds=round(time.perf_counter()-begin, 2)))
                print(json.dumps(summaries[-1]), flush=True)
                (folder/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            run, body = await submit()
            early = await watch(run, stop_early=True)
            replay = await watch(run)
            saved = await get(run)
            duplicate = await c.post('/api/chat/runs', json=body, headers=tokens[0])
            foreign = await c.get(f"/api/chat/runs/{run['id']}", headers=tokens[1])
            checks['disconnect_reconnect'] = bool(early['content']) and replay['content']==EXPECTED and saved['status']=='succeeded'
            checks['idempotent_after_completion'] = duplicate.status_code==200 and duplicate.json()['id']==run['id']
            checks['foreign_user_denied'] = foreign.status_code==404
            run, _ = await submit()
            await watch(run, stop_early=True)
            (await c.post(f"/api/chat/runs/{run['id']}/cancel", headers=tokens[0])).raise_for_status()
            cancelled = await watch(run)
            checks['cancel'] = (await get(run))['status']=='cancelled' and cancelled['terminal']=='cancelled'
            # Kill only the worker created by this script, while its model is producing.
            run, _ = await submit()
            await watch(run, stop_early=True)
            worker_process.kill()
            worker_process.wait(timeout=10)
            spawn('worker-restart', '--role', 'worker')
            begin = time.perf_counter()
            while time.perf_counter()-begin < 45:
                saved = await get(run)
                if saved['status'] not in ('queued', 'running'): break
                await asyncio.sleep(1)
            checks['worker_killed'] = dict(status=saved['status'], error=saved['error_code'],
                settled_seconds=round(time.perf_counter()-begin, 2), passed=saved['status']=='interrupted')
            run, _ = await submit()
            recovered = await watch(run)
            checks['new_run_after_worker_restart'] = recovered['content']==EXPECTED and (await get(run))['status']=='succeeded'
            print(json.dumps(checks), flush=True)
    except Exception as exc:
        report['aborted'] = type(exc).__name__ + ': ' + str(exc)
        raise
    finally:
        (folder/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        await redis.aclose()
        print('REPORT='+str(folder/'report.json'), flush=True)


if __name__ == '__main__':
    if args.role:
        child()
    else:
        if not args.redis_server: parser.error('--redis-server required')
        folder = ROOT/'.local'/'runs-tcp'/uuid.uuid4().hex
        folder.mkdir(parents=True)
        if args.trace_pool:
            os.environ['POOL_TRACE_DIR'] = str(folder)
        redis_port, api_port = port(), port()
        os.environ.update(DATABASE_URL='sqlite+aiosqlite:///'+(folder/'test.db').as_posix(),
            REDIS_URL=f'redis://127.0.0.1:{redis_port}/0', RUN_ENVIRONMENT=folder.name,
            CHAT_RUNS_ENABLED='true', RUN_WORKER_CONCURRENCY='8', RUN_LEASE_SECONDS='30',
            CHAT_RUNS_CAPACITY='100', OPENAI_API_KEY='test-no-model', OPENAI_BASE_URL='http://127.0.0.1:1',
            JWT_SECRET='isolated-runs-tcp-test-secret-not-production-123456')
        processes, logs = [], []
        def launch(name, command):
            log = (folder/(name+'.log')).open('wb')
            logs.append(log)
            p = subprocess.Popen(command, cwd=folder, stdout=log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            processes.append(p)
            return p
        def spawn(name, *a):
            return launch(name, [sys.executable, str(Path(__file__).resolve()), *a])
        try:
            launch('redis', [str(Path(args.redis_server).resolve()), '--bind', '127.0.0.1', '--port', str(redis_port),
                '--appendonly', 'yes', '--appendfsync', 'everysec', '--save', '', '--maxmemory', '128mb',
                '--maxmemory-policy', 'noeviction', '--dir', '.'])
            asyncio.run(test(folder, api_port, processes, spawn))
        finally:
            for p in reversed(processes):
                if p.poll() is None: p.terminate()
                p.wait(timeout=15)
            for log in logs: log.close()
