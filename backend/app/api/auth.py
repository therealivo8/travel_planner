import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.encoders import jsonable_encoder
from jose import JWTError
from sqlalchemy import func, inspect, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.demo import create_demo_trip
from app.core.deps import CurrentUser
from app.core.limiter import limiter
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token_claims,
    hash_password,
    issued_before_password_change,
    verify_password,
)
from app.core.security_log import (
    log_account_deleted,
    log_login_failed,
    log_password_changed,
    log_password_reset_completed,
    log_password_reset_requested,
)
from app.db.session import get_db
from app.models.logistics import PackingItem, TripExpense
from app.models.trip import Trip
from app.models.user import PasswordResetToken, User
from app.schemas.auth import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserOut,
    UserUpdate,
)
from app.services.email import password_reset_email, send_email

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"


def _set_refresh_cookie(response: Response, token: str) -> None:
    is_prod = settings.environment == "production"
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        samesite="none" if is_prod else "lax",
        secure=is_prod,
        max_age=30 * 24 * 60 * 60,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    # samesite/secure must match _set_refresh_cookie exactly — browsers only delete
    # a cookie when the clearing Set-Cookie shares its original attributes.
    is_prod = settings.environment == "production"
    response.delete_cookie(
        key=REFRESH_COOKIE,
        httponly=True,
        samesite="none" if is_prod else "lax",
        secure=is_prod,
        path="/",
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
async def register(
    request: Request,
    body: RegisterRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
    )
    db.add(user)
    try:
        await db.flush()
        # A ready-made example trip so the first screen isn't empty. Pure inserts: no
        # Google/ORS call, so registration spends none of the API budget.
        await create_demo_trip(db, user.id)
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    access = create_access_token(str(user.id))
    refresh = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh)
    return TokenResponse(access_token=access)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/hour")
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.hashed_password):
        # Logged (IP + Sentry warning event) so a credential-stuffing run
        # shows up as a spike — see docs/security-alerting.md for the alert
        # rule this feeds. Deliberately doesn't distinguish "unknown email"
        # from "wrong password" in the log, same as the client-facing
        # message below — that distinction is exactly what an attacker
        # would want to learn from logs if they were ever exposed.
        log_login_failed(request, email=body.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access = create_access_token(str(user.id))
    refresh = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh)
    return TokenResponse(access_token=access)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/hour")
async def refresh(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> TokenResponse:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    if not refresh_token:
        raise exc
    try:
        user_id, iat = decode_token_claims(refresh_token, "refresh")
    except JWTError:
        raise exc

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    # A password change/reset revokes every session that predates it.
    if user is None or issued_before_password_change(iat, user.password_changed_at):
        raise exc

    new_access = create_access_token(str(user.id))
    new_refresh = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(access_token=new_access)


@router.get("/me", response_model=UserOut)
async def me(current_user: CurrentUser) -> User:
    return current_user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    _clear_refresh_cookie(response)


NON_NULLABLE_PROFILE_FIELDS = ("units", "default_stop_minutes")


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UserUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    changes = body.model_dump(exclude_unset=True)
    for field in NON_NULLABLE_PROFILE_FIELDS:
        if field in changes and changes[field] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field} cannot be null")
    # The address and its coordinates are one fact; saving or clearing one without the
    # other would leave a home that can't pre-fill a trip.
    home = {"home_address", "home_lat", "home_lng"} & changes.keys()
    if home:
        values = [
            changes[f] if f in changes else getattr(current_user, f)
            for f in ("home_address", "home_lat", "home_lng")
        ]
        if any(v is None for v in values) and not all(v is None for v in values):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="home_address, home_lat and home_lng must be set or cleared together",
            )
    for field, value in changes.items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/change-password", response_model=TokenResponse)
@limiter.limit("5/hour")
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
    response: Response,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenResponse:
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(body.new_password)
    current_user.password_changed_at = datetime.now(UTC)
    await db.commit()
    log_password_changed(request, user_id=current_user.id)
    # Every other session is now revoked; hand this one fresh tokens so it stays signed in.
    _set_refresh_cookie(response, create_refresh_token(str(current_user.id)))
    return TokenResponse(access_token=create_access_token(str(current_user.id)))


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_everywhere(
    response: Response,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Sign out of every device, including this one."""
    current_user.password_changed_at = datetime.now(UTC)
    await db.commit()
    _clear_refresh_cookie(response)


# Cached Google/ORS content is not the user's data; share_token is a secret capability.
_EXPORT_EXCLUDED_TRIP_COLUMNS = {"route_raw_response", "radius_isochrone_geojson", "share_token"}


def _row(obj: Any, exclude: set[str] | None = None) -> dict[str, Any]:
    cols = inspect(type(obj)).mapper.column_attrs
    return {c.key: getattr(obj, c.key) for c in cols if c.key not in (exclude or set())}


@router.get("/me/export")
@limiter.limit("3/day")
async def export_my_data(
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    from sqlalchemy.orm import selectinload

    trips = (
        await db.execute(
            select(Trip)
            .where(Trip.user_id == current_user.id)
            .options(
                selectinload(Trip.waypoints),
                selectinload(Trip.itinerary_days),
            )
            .order_by(Trip.created_at)
        )
    ).scalars().all()
    trip_ids = [t.id for t in trips]
    expenses = (
        (await db.execute(select(TripExpense).where(TripExpense.trip_id.in_(trip_ids)))).scalars().all()
        if trip_ids
        else []
    )
    packing = (
        (await db.execute(select(PackingItem).where(PackingItem.trip_id.in_(trip_ids)))).scalars().all()
        if trip_ids
        else []
    )

    data = {
        "exported_at": datetime.now(UTC),
        "user": _row(current_user, {"hashed_password"}),
        "trips": [
            {
                **_row(t, _EXPORT_EXCLUDED_TRIP_COLUMNS),
                "waypoints": [_row(w) for w in sorted(t.waypoints, key=lambda w: w.position)],
                "itinerary_days": [
                    _row(d) for d in sorted(t.itinerary_days, key=lambda d: d.day_number)
                ],
                "expenses": [_row(e) for e in expenses if e.trip_id == t.id],
                "packing_items": [_row(i) for i in packing if i.trip_id == t.id],
            }
            for t in trips
        ],
    }
    import json

    body = json.dumps(jsonable_encoder(data), indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="road-trip-planner-export.json"'},
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/hour")
async def delete_account(
    request: Request,
    body: DeleteAccountRequest,
    response: Response,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Password is incorrect")
    user_id = current_user.id
    # Trips, waypoints, days, expenses, packing, quotas and reset tokens all hang off
    # users.id with ON DELETE CASCADE.
    await db.delete(current_user)
    await db.commit()
    log_account_deleted(request, user_id=user_id)
    _clear_refresh_cookie(response)


# ── password reset ──────────────────────────────────────────────────────────

RESET_TOKEN_TTL = timedelta(hours=1)
MAX_RESET_EMAILS_PER_HOUR = 3


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("3/hour")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    background: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    """Always 202, so the response never reveals whether an account exists."""
    log_password_reset_requested(request)
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if user is not None:
        # Per-email cap (the decorator above is per IP): stops one address being flooded.
        recent = (
            await db.execute(
                select(func.count())
                .select_from(PasswordResetToken)
                .where(
                    PasswordResetToken.user_id == user.id,
                    PasswordResetToken.created_at > datetime.now(UTC) - timedelta(hours=1),
                )
            )
        ).scalar_one()
        if recent < MAX_RESET_EMAILS_PER_HOUR:
            token = secrets.token_urlsafe(32)
            db.add(
                PasswordResetToken(
                    token_hash=_hash_reset_token(token),
                    user_id=user.id,
                    expires_at=datetime.now(UTC) + RESET_TOKEN_TTL,
                )
            )
            await db.commit()
            link = f"{settings.frontend_url.rstrip('/')}/reset-password?token={token}"
            subject, text = password_reset_email(link)
            background.add_task(send_email, user.email, subject, text)
    return {"detail": "If that email has an account, a reset link is on its way."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour")
async def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired")
    now = datetime.now(UTC)
    # Claim the token atomically: the UPDATE only matches an unused, unexpired token, so
    # two concurrent submissions can't both succeed.
    claimed = await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == _hash_reset_token(body.token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(PasswordResetToken.user_id)
    )
    user_id = claimed.scalar_one_or_none()
    if user_id is None:
        await db.rollback()
        raise invalid
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    user.hashed_password = hash_password(body.new_password)
    user.password_changed_at = now
    await db.commit()
    log_password_reset_completed(request, user_id=user.id)
    _clear_refresh_cookie(response)
