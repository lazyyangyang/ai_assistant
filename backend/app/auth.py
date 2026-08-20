"""Password hashing and typed JWT utilities."""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
import bcrypt

from app.config import get_settings


def hash_password(plain: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(plain.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _create_token(user_id: str, token_type: str, expires_delta: timedelta) -> str:
    """Create a typed JWT so refresh credentials cannot authorize API routes."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(
        user_id,
        "access",
        timedelta(minutes=settings.jwt_access_expire_minutes),
    )


def create_refresh_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(
        user_id,
        "refresh",
        timedelta(days=settings.jwt_refresh_expire_days),
    )


def _decode_token(token: str, expected_type: str) -> str | None:
    """Validate signature, expiry, subject shape and credential purpose together."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        # The explicit type check prevents a long-lived refresh token from being
        # accepted by dependencies that require a short-lived access token.
        if payload.get("type") != expected_type or not isinstance(user_id, str):
            return None
        return user_id
    except JWTError:
        return None


def decode_access_token(token: str) -> str | None:
    """Return the user id when a valid access token is supplied."""
    return _decode_token(token, "access")


def decode_refresh_token(token: str) -> str | None:
    """Return the user id when a valid refresh token is supplied."""
    return _decode_token(token, "refresh")
