"""Authentication endpoints with access-token refresh cookies."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_refresh_cookie(response: Response, user_id: str) -> None:
    """Issue a browser-only refresh credential scoped to authentication routes."""
    settings = get_settings()
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=create_refresh_token(user_id),
        max_age=settings.jwt_refresh_expire_days * 24 * 60 * 60,
        # Restrict ambient cookie transmission to auth endpoints; ordinary API
        # calls authenticate with the short-lived Authorization header instead.
        path="/api/auth",
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def _clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path="/api/auth",
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def _refresh_unauthorized(detail: str) -> JSONResponse:
    """Clear invalid browser credentials while returning a consistent 401 body."""
    response = JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={"detail": detail},
    )
    _clear_refresh_cookie(response)
    return response


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(User).where((User.email == body.email) | (User.username == body.username))
    )
    if existing.scalar_one_or_none():
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
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    _set_refresh_cookie(response, user.id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
        )

    token = create_access_token(user.id)
    _set_refresh_cookie(response, user.id)
    return TokenResponse(access_token=token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_access_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse | JSONResponse:
    """Rotate the refresh cookie and return a new in-memory access token."""
    settings = get_settings()
    refresh_token = request.cookies.get(settings.refresh_cookie_name)
    user_id = decode_refresh_token(refresh_token) if refresh_token else None
    if user_id is None:
        return _refresh_unauthorized("刷新凭证无效或已过期")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        return _refresh_unauthorized("用户不存在")

    # Rotation extends an active session while replacing the previously issued
    # browser credential; the access token remains deliberately short-lived.
    _set_refresh_cookie(response, user.id)
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> Response:
    _clear_refresh_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user
