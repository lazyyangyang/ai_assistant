"""FastAPI dependencies for auth & database."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import time

from app.auth import decode_access_claims
from app.database import get_db
from app.models.user import User
from app.models.auth_session import AuthSession

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    claims = decode_access_claims(credentials.credentials) if credentials else None
    session = await db.get(AuthSession, claims["sid"]) if claims else None
    if (not claims or not session or session.user_id != claims["sub"]
            or session.expires_at <= time.time()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效或已过期的 Token",
        )
    result = await db.execute(select(User).where(User.id == claims["sub"]))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )
    return user
