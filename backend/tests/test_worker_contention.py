import asyncio
import sqlite3
import pytest
from sqlalchemy.exc import OperationalError
from app import worker


def busy():
    original = sqlite3.OperationalError('database is locked')
    original.sqlite_errorcode = sqlite3.SQLITE_BUSY
    return OperationalError('COMMIT', {}, original)


@pytest.mark.asyncio
async def test_main_survives_claim_lock(monkeypatch):
    calls = []
    class Events:
        redis = None
        def __init__(self):
            self.redis = self
        async def ping(self): pass
        async def close(self): calls.append('closed')
    async def claim(_):
        calls.append('claim')
        if calls.count('claim') == 1:
            raise busy()
        raise asyncio.CancelledError()
    settings = worker.get_settings().model_copy(update={'chat_runs_enabled': True})
    monkeypatch.setattr(worker, 'get_settings', lambda: settings)
    monkeypatch.setattr(worker, 'RunEvents', Events)
    monkeypatch.setattr(worker, 'claim', claim)
    with pytest.raises(asyncio.CancelledError):
        await worker.main()
    assert calls == ['claim', 'claim', 'closed']


@pytest.mark.asyncio
async def test_persist_does_not_retry_non_lock(monkeypatch):
    calls = []
    async def persist(*args):
        calls.append(1)
        raise OperationalError('UPDATE', {}, sqlite3.OperationalError('no such table'))
    monkeypatch.setattr(worker, '_persist_once', persist)
    with pytest.raises(OperationalError):
        await worker.persist(None)
    assert len(calls) == 1

@pytest.mark.asyncio
async def test_real_file_lock_rolls_back_and_claim_recovers(monkeypatch, tmp_path):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from app.models import Base
    from app.services.sqlite_errors import is_sqlite_busy
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'locked.db'),
                                 connect_args={'timeout': 0.05})
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(worker, 'async_session_factory', factory)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with factory() as holder:
            await holder.execute(text('BEGIN IMMEDIATE'))
            with pytest.raises(OperationalError) as error:
                await worker.claim('contender')
            assert is_sqlite_busy(error.value)
            await holder.rollback()
        assert await worker.claim('recovered') is None
    finally:
        await engine.dispose()
