import os
import sys
import tempfile
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from pathlib import Path

BACKEND_DIR = str(Path(__file__).resolve().parents[1])
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


TEST_DB_PATH = os.path.join(tempfile.gettempdir(), f"ai_career_test_{uuid.uuid4().hex}.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"
os.environ["OPENAI_API_KEY"] = "test-no-external-service"
os.environ["OPENAI_BASE_URL"] = "http://127.0.0.1:1"
os.environ["STT_TRANSCRIBE_URL"] = "http://127.0.0.1:1/transcriptions"
os.environ["TTS_SPEECH_URL"] = "http://127.0.0.1:1/speech"


# Import after setting DATABASE_URL so Settings() and engine are created correctly.
from app.main import app  # noqa: E402
from app.database import async_session_factory, engine  # noqa: E402
from app.models.base import Base  # noqa: E402

# Ensure models are registered in Base.metadata
from app.models import chat as _chat_models  # noqa: F401,E402
from app.models import resume as _resume_models  # noqa: F401,E402
from app.models import user as _user_models  # noqa: F401,E402


@pytest.fixture(scope="session", autouse=True)
async def initialized_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture()
async def db_session(initialized_db) -> AsyncSession:
    async with async_session_factory() as session:
        yield session


@pytest.fixture()
async def async_client(initialized_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                           headers={"X-CSRF-Protection": "1"}) as client:
        yield client

