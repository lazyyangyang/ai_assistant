"""Password hashing & JWT utilities."""

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


def create_access_token(user_id: str, session_id: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    import uuid
    payload = {"sub": user_id, "sid": session_id, "type": "access",
               "exp": expire, "jti": uuid.uuid4().hex}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    """Return user_id or None if invalid/expired."""
    payload = decode_access_claims(token)
    return payload["sub"] if payload else None


def decode_access_claims(token: str) -> dict | None:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if (payload.get("type") != "access" or not payload.get("exp")
                or not isinstance(payload.get("sub"), str)
                or not isinstance(payload.get("sid"), str)):
            return None
        return payload
    except JWTError:
        return None
