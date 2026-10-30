import time
import pytest
from sqlalchemy import select
from app.models.auth_session import AuthSession
from scripts.cleanup_expired_auth_sessions import cleanup
from tests.test_refresh_auth import register_and_login


@pytest.mark.asyncio
async def test_cleanup_preview_and_execute_only_expired(async_client, db_session):
    first = await register_and_login(async_client)
    second = await register_and_login(async_client)
    expired_id, active_id = first.json()['session_id'], second.json()['session_id']
    expired = await db_session.get(AuthSession, expired_id)
    expired.expires_at = int(time.time()) - 1
    await db_session.commit()
    await cleanup()
    assert await db_session.scalar(select(AuthSession.id).where(AuthSession.id == expired_id)) == expired_id
    await db_session.rollback()
    await cleanup(execute=True)
    assert await db_session.scalar(select(AuthSession.id).where(AuthSession.id == expired_id)) is None
    assert await db_session.scalar(select(AuthSession.id).where(AuthSession.id == active_id)) == active_id
    await db_session.rollback()
    await cleanup(execute=True)
