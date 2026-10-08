from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _create_token(subject: str, expires_delta: timedelta, token_type: str) -> str:
    expire = datetime.now(UTC) + expires_delta
    # iat (whole seconds) lets password changes revoke tokens issued before them.
    payload = {"sub": subject, "exp": expire, "type": token_type, "iat": int(datetime.now(UTC).timestamp())}
    return str(jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm))


def create_access_token(user_id: str) -> str:
    return _create_token(
        user_id,
        timedelta(minutes=settings.access_token_expire_minutes),
        "access",
    )


def create_refresh_token(user_id: str) -> str:
    return _create_token(
        user_id,
        timedelta(days=settings.refresh_token_expire_days),
        "refresh",
    )


def decode_token(token: str, expected_type: str) -> str:
    """Decode a JWT and return the subject (user_id). Raises JWTError on failure."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("type") != expected_type:
        raise JWTError("wrong token type")
    sub: str = payload["sub"]
    return sub


def decode_token_claims(token: str, expected_type: str) -> tuple[str, int]:
    """Like decode_token, but also returns the issued-at time (0 for tokens minted before
    iat was added). Raises JWTError on failure."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    if payload.get("type") != expected_type:
        raise JWTError("wrong token type")
    return str(payload["sub"]), int(payload.get("iat", 0))


def issued_before_password_change(iat: int, password_changed_at: datetime | None) -> bool:
    """Whether a token predates the last password change. Compared in whole seconds, so a
    token minted in the same second as the change (the caller's own new session) survives."""
    return password_changed_at is not None and iat < int(password_changed_at.timestamp())
