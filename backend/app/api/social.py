import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.trip_access import (
    TripRole,
    accessible_to,
    display_name,
    get_trip_for,
    get_trip_with_role,
)
from app.db.session import get_db
from app.models.collab import StopVote, TripActivity, TripComment
from app.models.trip import CorridorSuggestion, ItineraryDay, RadiusSuggestion, Trip, Waypoint
from app.models.user import User
from app.schemas.collab import (
    ActivityOut,
    ChangesOut,
    CommentCreate,
    CommentKind,
    CommentOut,
    CommentUpdate,
    NotificationItem,
    NotificationsOut,
    VoteIn,
    VoteKind,
    Voter,
    VoteTally,
)

router = APIRouter(tags=["collaboration"])

DB = Annotated[AsyncSession, Depends(get_db)]

ACTIVITY_PAGE = 20
_TARGET_MODELS = {"radius": RadiusSuggestion, "corridor": CorridorSuggestion, "waypoint": Waypoint}
_COMMENT_MODELS = {"day": ItineraryDay, "waypoint": Waypoint}


async def _require_target(db: AsyncSession, trip_id: uuid.UUID, model: type, target_id: uuid.UUID) -> None:
    found = await db.execute(select(model.id).where(model.id == target_id, model.trip_id == trip_id))  # type: ignore[attr-defined]
    if found.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found on this trip")


# ── votes ───────────────────────────────────────────────────────────────────


async def _tallies(
    db: AsyncSession, trip_id: uuid.UUID, kind: str, viewer: User, target_id: uuid.UUID | None = None
) -> dict[str, VoteTally]:
    query = (
        select(StopVote, User)
        .join(User, User.id == StopVote.user_id)
        .where(StopVote.trip_id == trip_id, StopVote.suggestion_kind == kind)
    )
    if target_id is not None:
        query = query.where(StopVote.target_id == target_id)
    out: dict[str, VoteTally] = defaultdict(VoteTally)
    for vote, user in (await db.execute(query)).all():
        tally = out[str(vote.target_id)]
        tally.up += vote.value > 0
        tally.down += vote.value < 0
        if user.id == viewer.id:
            tally.mine = vote.value
        tally.voters.append(Voter(user_id=user.id, name=display_name(user), value=vote.value))
    return dict(out)


@router.get("/trips/{trip_id}/votes", response_model=dict[str, VoteTally])
async def list_votes(
    trip_id: uuid.UUID, current_user: CurrentUser, db: DB, kind: VoteKind = Query(...)
) -> dict[str, VoteTally]:
    await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    return await _tallies(db, trip_id, kind, current_user)


@router.put("/trips/{trip_id}/votes", response_model=VoteTally)
async def cast_vote(trip_id: uuid.UUID, body: VoteIn, current_user: CurrentUser, db: DB) -> VoteTally:
    """Viewers vote too. Voting isn't an edit of the trip, so it doesn't bump the version."""
    await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    await _require_target(db, trip_id, _TARGET_MODELS[body.kind], body.target_id)
    if body.value == 0:
        await db.execute(
            StopVote.__table__.delete().where(  # type: ignore[attr-defined]
                StopVote.suggestion_kind == body.kind,
                StopVote.target_id == body.target_id,
                StopVote.user_id == current_user.id,
            )
        )
    else:
        stmt = insert(StopVote).values(
            suggestion_kind=body.kind,
            target_id=body.target_id,
            user_id=current_user.id,
            value=body.value,
            trip_id=trip_id,
        )
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["suggestion_kind", "target_id", "user_id"],
                set_={"value": stmt.excluded.value},
            )
        )
    await db.commit()
    tallies = await _tallies(db, trip_id, body.kind, current_user, body.target_id)
    return tallies.get(str(body.target_id), VoteTally())


# ── comments ────────────────────────────────────────────────────────────────


async def _comment_out(c: TripComment, author: User, viewer: User) -> CommentOut:
    deleted = c.deleted_at is not None
    return CommentOut(
        id=c.id,
        user_id=c.user_id,
        author=display_name(author),
        body="" if deleted else c.body,
        created_at=c.created_at,
        edited_at=c.edited_at,
        deleted=deleted,
        mine=c.user_id == viewer.id,
    )


@router.get("/trips/{trip_id}/comments/counts", response_model=dict[str, int])
async def comment_counts(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict[str, int]:
    """Live comment counts keyed "kind:target_id" (the trip thread is "trip:")."""
    await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    rows = (
        await db.execute(
            select(TripComment.target_kind, TripComment.target_id, func.count())
            .where(TripComment.trip_id == trip_id, TripComment.deleted_at.is_(None))
            .group_by(TripComment.target_kind, TripComment.target_id)
        )
    ).all()
    return {f"{kind}:{target or ''}": n for kind, target, n in rows}


@router.get("/trips/{trip_id}/comments", response_model=list[CommentOut])
async def list_comments(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    target_kind: CommentKind = Query(...),
    target_id: uuid.UUID | None = Query(None),
) -> list[CommentOut]:
    await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    query = (
        select(TripComment, User)
        .join(User, User.id == TripComment.user_id)
        .where(TripComment.trip_id == trip_id, TripComment.target_kind == target_kind)
        .order_by(TripComment.created_at)
    )
    query = query.where(
        TripComment.target_id.is_(None) if target_id is None else TripComment.target_id == target_id
    )
    return [await _comment_out(c, u, current_user) for c, u in (await db.execute(query)).all()]


@router.post("/trips/{trip_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(
    trip_id: uuid.UUID, body: CommentCreate, current_user: CurrentUser, db: DB
) -> CommentOut:
    await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    if body.target_kind == "trip":
        if body.target_id is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The trip thread has no target")
    else:
        if body.target_id is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="target_id is required")
        await _require_target(db, trip_id, _COMMENT_MODELS[body.target_kind], body.target_id)
    comment = TripComment(
        trip_id=trip_id,
        user_id=current_user.id,
        target_kind=body.target_kind,
        target_id=body.target_id,
        body=body.body.strip(),
    )
    db.add(comment)
    # Surfaces in the activity feed and notification bell. A comment isn't an edit of the
    # trip, so the version (and other people's edits) are untouched.
    db.add(
        TripActivity(
            trip_id=trip_id,
            user_id=current_user.id,
            kind="comment",
            summary=f"{display_name(current_user)} commented on {'the trip' if body.target_kind == 'trip' else 'a ' + body.target_kind}",
        )
    )
    await db.commit()
    await db.refresh(comment)
    return await _comment_out(comment, current_user, current_user)


async def _own_or_owner_comment(
    db: AsyncSession, trip_id: uuid.UUID, comment_id: uuid.UUID, user: User, *, owner_may: bool
) -> TripComment:
    trip, role = await get_trip_with_role(trip_id, user, db, TripRole.VIEWER)
    comment = (
        await db.execute(
            select(TripComment).where(TripComment.id == comment_id, TripComment.trip_id == trip_id)
        )
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if comment.user_id != user.id and not (owner_may and role == TripRole.OWNER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You can only change your own comments")
    return comment


@router.patch("/trips/{trip_id}/comments/{comment_id}", response_model=CommentOut)
async def edit_comment(
    trip_id: uuid.UUID, comment_id: uuid.UUID, body: CommentUpdate, current_user: CurrentUser, db: DB
) -> CommentOut:
    comment = await _own_or_owner_comment(db, trip_id, comment_id, current_user, owner_may=False)
    if comment.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Comment not found")
    comment.body = body.body.strip()
    comment.edited_at = datetime.now(UTC)
    await db.commit()
    return await _comment_out(comment, current_user, current_user)


@router.delete("/trips/{trip_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    trip_id: uuid.UUID, comment_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    """Soft delete, so the thread keeps its shape ("deleted"). The owner may moderate."""
    comment = await _own_or_owner_comment(db, trip_id, comment_id, current_user, owner_may=True)
    comment.deleted_at = datetime.now(UTC)
    await db.commit()


# ── activity, changes, notifications ────────────────────────────────────────


async def _recent_activity(db: AsyncSession, trip_id: uuid.UUID) -> list[ActivityOut]:
    rows = (
        await db.execute(
            select(TripActivity)
            .where(TripActivity.trip_id == trip_id)
            .order_by(TripActivity.created_at.desc())
            .limit(ACTIVITY_PAGE)
        )
    ).scalars()
    return [
        ActivityOut(id=a.id, trip_id=a.trip_id, kind=a.kind, summary=a.summary, created_at=a.created_at)
        for a in rows
    ]


@router.get("/trips/{trip_id}/activity", response_model=list[ActivityOut])
async def trip_activity(trip_id: uuid.UUID, current_user: CurrentUser, db: DB) -> list[ActivityOut]:
    await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    return await _recent_activity(db, trip_id)


@router.get("/trips/{trip_id}/changes", response_model=ChangesOut)
async def trip_changes(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    since_version: int | None = Query(None, ge=0),
) -> ChangesOut:
    """Cheap poll target: a single-row read, with the activity feed only when something changed."""
    trip = await get_trip_for(trip_id, current_user, db, TripRole.VIEWER)
    changed = since_version is not None and trip.version != since_version
    return ChangesOut(
        version=trip.version,
        changed=changed,
        activity=await _recent_activity(db, trip_id) if changed or since_version is None else [],
    )


@router.get("/notifications", response_model=NotificationsOut)
async def notifications(current_user: CurrentUser, db: DB) -> NotificationsOut:
    """Activity and comments by other people on the user's trips since they last looked."""
    since = current_user.last_seen_activity_at or current_user.created_at
    base = and_(
        accessible_to(current_user),
        TripActivity.user_id.is_distinct_from(current_user.id),
    )
    unread = (
        await db.execute(
            select(func.count())
            .select_from(TripActivity)
            .join(Trip, Trip.id == TripActivity.trip_id)
            .where(base, TripActivity.created_at > since)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(TripActivity, Trip.title)
            .join(Trip, Trip.id == TripActivity.trip_id)
            .where(base)
            .order_by(TripActivity.created_at.desc())
            .limit(ACTIVITY_PAGE)
        )
    ).all()
    return NotificationsOut(
        unread=unread,
        items=[
            NotificationItem(
                id=a.id,
                trip_id=a.trip_id,
                kind=a.kind,
                summary=a.summary,
                created_at=a.created_at,
                trip_title=title,
            )
            for a, title in rows
        ],
    )


@router.post("/notifications/seen", status_code=status.HTTP_204_NO_CONTENT)
async def mark_notifications_seen(current_user: CurrentUser, db: DB) -> None:
    await db.execute(
        update(User).where(User.id == current_user.id).values(last_seen_activity_at=datetime.now(UTC))
    )
    await db.commit()
