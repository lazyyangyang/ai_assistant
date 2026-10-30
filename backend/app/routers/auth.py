"""Authentication endpoints: register / login / me."""

import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import create_access_token, hash_password, verify_password
from app.database import get_db
from app.config import get_settings
from app.deps import get_current_user
from app.models.user import User
from app.services.auth_sessions import create_login_session, validate_refresh_session, revoke_login_session
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "ai_career_tab_refresh"


def validate_session_id(sid: str):
    if not re.fullmatch(r"[0-9a-f]{32}", sid):
        raise HTTPException(422, "无效的认证会话 ID")
    return sid


def refresh_cookie_path(sid: str):
    return f"/api/auth/sessions/{validate_session_id(sid)}/"


def require_auth_request(request: Request):
    """Custom header + explicit origin allowlist protect cookie mutations from CSRF."""
    if request.headers.get("x-csrf-protection") != "1":
        raise HTTPException(403, "缺少认证请求保护头")
    origin = request.headers.get("origin")
    allowed = [*get_settings().auth_allowed_origins, str(request.base_url).rstrip("/")]
    if origin and origin not in allowed:
        raise HTTPException(403, "不允许的请求来源")


def token_response(user_id: str, session_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return TokenResponse(
        access_token=create_access_token(user_id, session_id),
        session_id=session_id,
        expires_in=get_settings().jwt_expire_minutes * 60,
    )


async def issue_session(user: User, request: Request, response: Response, db: AsyncSession):
    settings = get_settings()
    session, token = await create_login_session(db, user)
    lifetime = settings.refresh_expire_days * 86400
    response.set_cookie(COOKIE_NAME, token, max_age=lifetime, httponly=True,
                        secure=settings.refresh_cookie_secure, samesite="strict",
                        path=refresh_cookie_path(session.id))
    return token_response(session.user_id, session.id, response)


def is_registration_conflict(error: IntegrityError) -> bool:
    """Recognize only the username/email unique constraints, not other failures."""
    original = error.orig
    if isinstance(original, sqlite3.IntegrityError):
        return (
            getattr(original, "sqlite_errorcode", None) == sqlite3.SQLITE_CONSTRAINT_UNIQUE
            and str(original) in {
                "UNIQUE constraint failed: users.username",
                "UNIQUE constraint failed: users.email",
            }
        )
    # PostgreSQL drivers expose structured constraint metadata (asyncpg via cause).
    cause = original.__cause__ or original
    diagnostic = getattr(cause, "diag", cause)
    return (
        getattr(cause, "sqlstate", None) == "23505"
        and getattr(diagnostic, "constraint_name", None)
        in {"ix_users_username", "ix_users_email", "users_username_key", "users_email_key"}
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_auth_request)])
async def register(body: RegisterRequest, response: Response,
                   db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(User.id).where(
            (User.email == body.email) | (User.username == body.username)
        ).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该邮箱或用户名已被注册",
        )

    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if is_registration_conflict(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该邮箱或用户名已被注册",
            ) from exc
        raise
    await db.refresh(user)

    response.headers["Cache-Control"] = "no-store"
    return user


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(require_auth_request)])
async def login(body: LoginRequest, request: Request, response: Response,
                db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )

    return await issue_session(user, request, response, db)


@router.post("/sessions/{sid}/refresh", response_model=TokenResponse,
             dependencies=[Depends(require_auth_request)])
async def refresh(sid: str, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    validate_session_id(sid)
    session = await validate_refresh_session(db, sid, request.cookies.get(COOKIE_NAME))
    return token_response(session.user_id, session.id, response)


@router.post("/sessions/{sid}/logout", status_code=204, dependencies=[Depends(require_auth_request)])
async def logout(sid: str, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    validate_session_id(sid)
    await revoke_login_session(db, sid, request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME, path=refresh_cookie_path(sid), httponly=True,
                           secure=get_settings().refresh_cookie_secure, samesite="strict")


@router.post("/refresh")
@router.post("/logout")
async def retired_auth_protocol():
    raise HTTPException(410, "认证协议已更新，请刷新页面重新登录")


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user
