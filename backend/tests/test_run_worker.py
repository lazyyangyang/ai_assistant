import json
import uuid
import pytest
from sqlalchemy import select
from app import worker
from app.database import async_session_factory
from app.models.chat import ChatSession, ChatMessage, AgentType
from app.models.chat_run import ChatRun
from app.models.user import User


class Events:
    def __init__(self, fail=False):
        self.events = []
        self.fail = fail

    async def publish(self, run, event, data, terminal=False):
        if self.fail:
            raise ConnectionError('Redis offline')
        if event == 'completed':
            async with async_session_factory() as db:
                assert (await db.get(ChatRun, run.id)).status == 'succeeded'
        self.events.append(event)


async def queued(mode='new'):
    async with async_session_factory() as db:
        user = User(username=uuid.uuid4().hex, email=uuid.uuid4().hex+'@example.com', hashed_password='unused')
        db.add(user)
        await db.flush()
        session = ChatSession(user_id=user.id, agent_type=AgentType.JD, jd_content='{"summary":"old"}')
        db.add(session)
        await db.flush()
        question = ChatMessage(session_id=session.id, role='user', content='JD')
        answer = ChatMessage(session_id=session.id, role='assistant', content='')
        db.add_all([question, answer])
        await db.flush()
        run = ChatRun(user_id=user.id, session_id=session.id, client_request_id=uuid.uuid4().hex,
            request_hash='hash', input_json=json.dumps({'request': {'content': 'JD', 'mode': mode}, 'history': [], 'jd_context': None}),
            user_message_id=question.id, assistant_message_id=answer.id)
        db.add(run)
        await db.commit()
        return run.id


async def tokens(*args, **kwargs):
    yield '中文'
    yield '分析'


async def extract(*args, **kwargs):
    return {'summary': 'new', 'skills': [], 'responsibilities': [], 'hard_requirements': []}


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['new', 'followup'])
async def test_durable_completion(monkeypatch, mode):
    run_id = await queued(mode)
    monkeypatch.setattr(worker, 'stream_agent_response', tokens)
    monkeypatch.setattr(worker, 'extract_jd_structured', extract)
    run = await worker.claim('worker')
    assert run.id == run_id
    assert await worker.claim('duplicate') is None
    events = Events()
    await worker.execute(run, events)
    async with async_session_factory() as db:
        saved = await db.get(ChatRun, run_id)
        assert saved.status == 'succeeded'
        assert saved.result_text == '中文分析'
        session = await db.get(ChatSession, saved.session_id)
        assert json.loads(session.jd_content)['summary'] == ('old' if mode == 'followup' else 'new')
    assert events.events[-1] == 'completed'


@pytest.mark.asyncio
async def test_extraction_failure_preserves_text_and_card(monkeypatch):
    await queued()
    monkeypatch.setattr(worker, 'stream_agent_response', tokens)
    async def broken(*args, **kwargs):
        raise ValueError('invalid structured output')
    monkeypatch.setattr(worker, 'extract_jd_structured', broken)
    run = await worker.claim('worker')
    await worker.execute(run, Events())
    async with async_session_factory() as db:
        saved = await db.get(ChatRun, run.id)
        assert saved.status == 'failed'
        assert saved.result_text == '中文分析'
        assert saved.error_code == 'structured_failed'
        assert json.loads((await db.get(ChatSession, run.session_id)).jd_content)['summary'] == 'old'


@pytest.mark.asyncio
async def test_redis_failure_stops_generation(monkeypatch):
    await queued()
    async def forbidden(*args, **kwargs):
        raise AssertionError('model must not start')
        yield ''
    monkeypatch.setattr(worker, 'stream_agent_response', forbidden)
    run = await worker.claim('worker')
    await worker.execute(run, Events(fail=True))
    async with async_session_factory() as db:
        assert (await db.get(ChatRun, run.id)).status == 'failed'


@pytest.mark.asyncio
async def test_expired_worker_cannot_save():
    await queued()
    run = await worker.claim('old')
    async with async_session_factory() as db:
        saved = await db.get(ChatRun, run.id)
        saved.lease_until = 1
        await db.commit()
    assert await worker.claim('new') is None
    with pytest.raises(worker.LostLease):
        await worker.persist(run, 'succeeded')


@pytest.mark.asyncio
async def test_cancellation_is_confirmed_before_success(monkeypatch):
    await queued()
    run = await worker.claim('worker')
    async with async_session_factory() as db:
        saved = await db.get(ChatRun, run.id)
        saved.cancel_requested = True
        await db.commit()
    monkeypatch.setattr(worker, 'stream_agent_response', tokens)
    monkeypatch.setattr(worker, 'extract_jd_structured', extract)
    await worker.execute(run, Events())
    async with async_session_factory() as db:
        assert (await db.get(ChatRun, run.id)).status == 'cancelled'
