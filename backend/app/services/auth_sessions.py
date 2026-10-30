"""Session-scoped refresh credentials and atomic admission."""
import hashlib
import secrets
import time

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models.auth_session import AuthSession
from app.models.user import User


def refresh_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_login_session(db: AsyncSession, user: User):
    user_id, password_hash = user.id, user.hashed_password
    bind = db.bind
    await db.rollback()  # End the credential read transaction before acquiring a write lock.
    settings = get_settings()
    raw = secrets.token_urlsafe(48)
    factory = async_sessionmaker(bind, expire_on_commit=False)
    async with factory() as writer:
        try:
            if bind.dialect.name == 'sqlite':
                await writer.execute(text('BEGIN IMMEDIATE'))
                current = await writer.get(User, user_id)
            elif bind.dialect.name == 'postgresql':
                current = (await writer.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one_or_none()
            else:
                raise HTTPException(503, '当前数据库不支持会话配额事务')
            if not current or current.hashed_password != password_hash:
                raise HTTPException(401, '账号凭证已改变，请重新登录')
            now = int(time.time())
            count = await writer.scalar(select(func.count()).select_from(AuthSession).where(
                AuthSession.user_id == user_id, AuthSession.expires_at > now))
            if count >= settings.auth_max_active_sessions_per_user:
                raise HTTPException(409, '登录会话已达上限，请退出仍打开的会话或等待会话到期')
            session = AuthSession(user_id=user_id, refresh_hash=refresh_hash(raw),
                                  expires_at=now + settings.refresh_expire_days * 86400)
            writer.add(session)
            await writer.commit()
            return session, raw
        except OperationalError as exc:
            await writer.rollback()
            if 'locked' in str(exc).lower() or 'busy' in str(exc).lower():
                raise HTTPException(503, '登录服务忙，请稍后重试', headers={'Retry-After': '1'}) from exc
            raise


async def validate_refresh_session(db: AsyncSession, sid: str, raw: str | None):
    session = await db.get(AuthSession, sid)
    if (not session or session.expires_at <= int(time.time()) or not raw
            or not secrets.compare_digest(session.refresh_hash, refresh_hash(raw))
            or not await db.get(User, session.user_id)):
        raise HTTPException(401, '登录已过期，请重新登录')
    return session


async def revoke_login_session(db: AsyncSession, sid: str, raw: str | None):
    session = await db.get(AuthSession, sid)
    if not session:
        return
    if session.expires_at > int(time.time()):
        if not raw or not secrets.compare_digest(session.refresh_hash, refresh_hash(raw)):
            raise HTTPException(401, '退出请求被拒绝，请重试或验证当前会话')
    await db.execute(delete(AuthSession).where(
        AuthSession.id == sid, AuthSession.refresh_hash == session.refresh_hash))
    await db.commit()
