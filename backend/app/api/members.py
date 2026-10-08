import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import CurrentUser
from app.core.limiter import limiter
from app.core.security_log import log_membership
from app.core.trip_access import TripRole, display_name, get_trip_for, get_trip_with_role
from app.db.session import get_db
from app.models.collab import TripActivity, TripInvite, TripMember
from app.models.trip import Trip
from app.models.user import User
from app.schemas.collab import (
    InviteAccepted,
    InviteCreate,
    InviteCreated,
    InviteOut,
    InvitePreview,
    MemberOut,
    MemberUpdate,
)
from app.services.email import send_email

logger = logging.getLogger(__name__)

router = APIRouter(tags=["members"])

DB = Annotated[AsyncSession, Depends(get_db)]

INVITE_TTL = timedelta(days=14)
DEFAULT_MAX_USES = 10


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── members ─────────────────────────────────────────────────────────────────


@router.get("/trips/{trip_id}/members", response_model=list[MemberOut])
async def list_members(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> list[MemberOut]:
    trip = await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    owner = await db.get(User, trip.user_id)
    assert owner is not None
    out = [
        MemberOut(
            user_id=owner.id,
            name=display_name(owner),
            role="owner",
            is_you=owner.id == current_user.id,
            joined_at=None,
        )
    ]
    rows = (
        await db.execute(
            select(TripMember, User)
            .join(User, User.id == TripMember.user_id)
            .where(TripMember.trip_id == trip_id)
            .order_by(TripMember.created_at)
        )
    ).all()
    out += [
        MemberOut(
            user_id=u.id,
            name=display_name(u),
            role=m.role,
            is_you=u.id == current_user.id,
            joined_at=m.created_at,
        )
        for m, u in rows
    ]
    return out


@router.patch("/trips/{trip_id}/members/{user_id}", response_model=MemberOut)
async def change_member_role(
    request: Request,
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberUpdate,
    current_user: CurrentUser,
    db: DB,
) -> MemberOut:
    await get_trip_for(trip_id, current_user, db, TripRole.OWNER)
    member = (
        await db.execute(
            select(TripMember).where(TripMember.trip_id == trip_id, TripMember.user_id == user_id)
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    member.role = body.role
    await db.commit()
    log_membership("trip.member_role_changed", request, actor_id=current_user.id, trip_id=trip_id)
    user = await db.get(User, user_id)
    assert user is not None
    return MemberOut(
        user_id=user_id, name=display_name(user), role=member.role, is_you=False, joined_at=member.created_at
    )


@router.delete("/trips/{trip_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    request: Request, trip_id: uuid.UUID, user_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    """The owner removes anyone; a member may remove themselves (leave the trip)."""
    leaving = user_id == current_user.id
    trip, role = await get_trip_with_role(
        trip_id, current_user, db, TripRole.VIEWER if leaving else TripRole.OWNER
    )
    if user_id == trip.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="The owner can't be removed from their own trip")
    member = (
        await db.execute(
            select(TripMember).where(TripMember.trip_id == trip_id, TripMember.user_id == user_id)
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Member not found")
    await db.delete(member)
    await db.commit()
    log_membership(
        "trip.member_left" if leaving else "trip.member_removed",
        request,
        actor_id=current_user.id,
        trip_id=trip_id,
    )


# ── invites ─────────────────────────────────────────────────────────────────


@router.post("/trips/{trip_id}/invites", response_model=InviteCreated, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/day")
async def create_invite(
    request: Request,
    trip_id: uuid.UUID,
    body: InviteCreate,
    background: BackgroundTasks,
    current_user: CurrentUser,
    db: DB,
) -> InviteCreated:
    trip = await get_trip_for(trip_id, current_user, db, TripRole.OWNER)
    token = secrets.token_urlsafe(32)
    invite = TripInvite(
        token_hash=_hash(token),
        trip_id=trip_id,
        role=body.role,
        created_by=current_user.id,
        expires_at=datetime.now(UTC) + INVITE_TTL,
        max_uses=DEFAULT_MAX_USES,
    )
    db.add(invite)
    await db.commit()
    log_membership("trip.invite_created", request, actor_id=current_user.id, trip_id=trip_id)

    url = f"{settings.frontend_url.rstrip('/')}/invite/{token}"
    emailed = False
    if body.email:
        # With no Resend key the email is logged to the console instead (see services.email).
        background.add_task(
            send_email,
            body.email,
            f"{display_name(current_user)} invited you to plan \"{trip.title}\"",
            f"{display_name(current_user)} invited you to join the road trip \"{trip.title}\" "
            f"as {'an editor' if body.role == 'editor' else 'a viewer'}.\n\n"
            f"Open this link to join (expires in 14 days):\n{url}\n",
        )
        emailed = True
    return InviteCreated(
        id=invite.id,
        role=body.role,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        uses=0,
        url=url,
        emailed=emailed,
    )


@router.get("/trips/{trip_id}/invites", response_model=list[InviteOut])
async def list_invites(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> list[InviteOut]:
    await get_trip_for(trip_id, current_user, db, TripRole.OWNER)
    rows = (
        await db.execute(
            select(TripInvite)
            .where(
                TripInvite.trip_id == trip_id,
                TripInvite.revoked_at.is_(None),
                TripInvite.expires_at > datetime.now(UTC),
            )
            .order_by(TripInvite.created_at.desc())
        )
    ).scalars()
    return [
        InviteOut(id=i.id, role=i.role, expires_at=i.expires_at, max_uses=i.max_uses, uses=i.uses)
        for i in rows
        if i.uses < i.max_uses
    ]


@router.delete("/trips/{trip_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    request: Request, trip_id: uuid.UUID, invite_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    await get_trip_for(trip_id, current_user, db, TripRole.OWNER)
    result = await db.execute(
        update(TripInvite)
        .where(TripInvite.id == invite_id, TripInvite.trip_id == trip_id)
        .values(revoked_at=datetime.now(UTC))
        .returning(TripInvite.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Invite not found")
    await db.commit()
    log_membership("trip.invite_revoked", request, actor_id=current_user.id, trip_id=trip_id)


async def _usable_invite(db: AsyncSession, token: str) -> TripInvite | None:
    invite = (
        await db.execute(select(TripInvite).where(TripInvite.token_hash == _hash(token)))
    ).scalar_one_or_none()
    if (
        invite is None
        or invite.revoked_at is not None
        or invite.expires_at <= datetime.now(UTC)
        or invite.uses >= invite.max_uses
    ):
        return None
    return invite


@router.get("/invites/{token}", response_model=InvitePreview)
@limiter.limit("60/hour")
async def preview_invite(request: Request, token: str, db: DB) -> InvitePreview:
    """What the invite page shows before sign-in. The token itself is the secret."""
    invite = await _usable_invite(db, token)
    if invite is None:
        return InvitePreview(valid=False)
    trip = await db.get(Trip, invite.trip_id)
    owner = await db.get(User, trip.user_id) if trip else None
    if trip is None or owner is None:
        return InvitePreview(valid=False)
    return InvitePreview(
        valid=True, trip_title=trip.title, owner_name=display_name(owner), role=invite.role
    )


@router.post("/invites/{token}/accept", response_model=InviteAccepted)
@limiter.limit("30/hour")
async def accept_invite(
    request: Request, token: str, current_user: CurrentUser, db: DB
) -> InviteAccepted:
    """Idempotent. An existing member keeps their role (never demoted) and the owner is a
    no-op; neither consumes one of the invite's uses."""
    invite = await _usable_invite(db, token)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This invite link is invalid or has expired")
    trip = await db.get(Trip, invite.trip_id)
    assert trip is not None
    if trip.user_id == current_user.id:
        return InviteAccepted(trip_id=trip.id, role="owner")
    existing = (
        await db.execute(
            select(TripMember).where(TripMember.trip_id == trip.id, TripMember.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return InviteAccepted(trip_id=trip.id, role=existing.role)

    # Claim a use atomically: the UPDATE only matches while the invite is still usable, so
    # concurrent acceptances can't push `uses` past `max_uses`.
    claimed = await db.execute(
        update(TripInvite)
        .where(
            TripInvite.token_hash == invite.token_hash,
            TripInvite.revoked_at.is_(None),
            TripInvite.expires_at > datetime.now(UTC),
            TripInvite.uses < TripInvite.max_uses,
        )
        .values(uses=TripInvite.uses + 1)
        .returning(TripInvite.uses)
    )
    if claimed.scalar_one_or_none() is None:
        await db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This invite link is invalid or has expired")
    await db.execute(
        insert(TripMember)
        .values(trip_id=trip.id, user_id=current_user.id, role=invite.role, invited_by=invite.created_by)
        .on_conflict_do_nothing()
    )
    db.add(
        TripActivity(
            trip_id=trip.id,
            user_id=current_user.id,
            kind="member_joined",
            summary=f"{display_name(current_user)} joined as {'an editor' if invite.role == 'editor' else 'a viewer'}",
        )
    )
    await db.commit()
    log_membership("trip.invite_accepted", request, actor_id=current_user.id, trip_id=trip.id)
    return InviteAccepted(trip_id=trip.id, role=invite.role)
