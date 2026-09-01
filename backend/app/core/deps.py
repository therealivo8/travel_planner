import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.core.security_log import log_unauthorized
from app.db.session import get_db
from app.models.user import User

bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials:
        log_unauthorized(request)
        raise exc
    try:
        user_id = decode_token(credentials.credentials, "access")
    except JWTError:
        log_unauthorized(request)
        raise exc

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        log_unauthorized(request)
        raise exc
    # Read by app.core.limiter's key function so rate limits are keyed per-user
    # instead of per-IP for authenticated requests.
    request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
