"""Isolated real-auth E2E server. External model and speech boundaries are fixtures."""
import os
import asyncio
import sys
from pathlib import Path
from contextlib import asynccontextmanager

root = Path(os.environ['AI_CAREER_E2E_DIR']).resolve()
expected = Path(__file__).resolve().parents[2] / 'frontend' / 'test-results'
if not root.is_relative_to(expected.resolve()):
    raise RuntimeError('E2E database must be inside frontend/test-results')
root.mkdir(parents=True, exist_ok=True)
database = root / 'e2e.db'
os.environ.update(DATABASE_URL=f'sqlite+aiosqlite:///{database.as_posix()}',
                  OPENAI_API_KEY='e2e-no-external-service', OPENAI_BASE_URL='http://127.0.0.1:1',
                  JWT_SECRET='isolated-e2e-secret-not-for-production', REFRESH_COOKIE_SECURE='false',
                  AUTH_MAX_ACTIVE_SESSIONS_PER_USER='20', CHAT_RUNS_ENABLED='true',
                  AUTH_ALLOWED_ORIGINS=f'["http://127.0.0.1:{os.environ["AI_CAREER_E2E_FRONT_PORT"]}"]')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app
from app.database import engine
from app.models.base import Base
from app import worker
import app.routers.chat as chat
import app.routers.stt as stt
import app.routers.tts as tts


async def stream(*args, **kwargs):
    for text in ('你好，', '这是隔离测试回答。'):
        yield text


async def structured(*args, **kwargs):
    return {'skills': ['React'], 'responsibilities': ['测试开发'], 'hard_requirements': [], 'summary': '测试岗位'}


async def feedback(*args, **kwargs):
    return {'overallScore': 8, 'overallSummary': '测试报告', 'aspects': [], 'improvements': []}


async def transcribe(**kwargs):
    return '测试录音内容'


async def synthesize(**kwargs):
    return b'RIFF-test-audio', 'audio/wav'


chat.stream_agent_response = stream
worker.stream_agent_response = stream
worker.extract_jd_structured = structured
chat.extract_interview_feedback = feedback
stt._transcribe_via_openai_compat = transcribe
tts._synthesize_via_openai_compat = synthesize


class FixtureRunEvents:
    """身份隔离测试只验证持久化结果；Redis 传输由专门的集成测试覆盖。"""
    async def publish(self, *args, **kwargs):
        pass


async def execute_fixture_runs():
    while True:
        run = await worker.claim('e2e-fixture-worker')
        if run:
            await worker.execute(run, FixtureRunEvents())
        else:
            await asyncio.sleep(0.05)


@asynccontextmanager
async def lifespan(app):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    worker_task = asyncio.create_task(execute_fixture_runs())
    try:
        yield
    finally:
        worker_task.cancel()
        await asyncio.gather(worker_task, return_exceptions=True)
        await engine.dispose()


app.router.lifespan_context = lifespan


@app.get('/api/e2e/isolation')
async def isolation():
    return {'run': root.name, 'database': database.name, 'external_services': 'fixtures'}
