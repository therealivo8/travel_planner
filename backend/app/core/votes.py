"""Group votes on stop suggestions survive a re-run of discovery.

Re-running discovery replaces the suggestion rows (new ids), which would orphan every vote.
Suggestions describe places, so votes are carried over to the new row for the same place_id.
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collab import StopVote


async def carry_over_votes(
    db: AsyncSession,
    trip_id: uuid.UUID,
    kind: str,
    old: Iterable[tuple[uuid.UUID, str]],
    new: Iterable[tuple[uuid.UUID, str]],
) -> None:
    """`old`/`new` are (suggestion id, place_id) pairs before and after discovery."""
    old_place = dict(old)
    new_by_place = {place: sid for sid, place in new}
    if not old_place:
        return
    votes = (
        await db.execute(
            select(StopVote).where(
                StopVote.trip_id == trip_id,
                StopVote.suggestion_kind == kind,
                StopVote.target_id.in_(list(old_place)),
            )
        )
    ).scalars().all()
    carried = [
        {
            "suggestion_kind": kind,
            "target_id": new_by_place[old_place[v.target_id]],
            "user_id": v.user_id,
            "value": v.value,
            "trip_id": trip_id,
        }
        for v in votes
        if old_place[v.target_id] in new_by_place
    ]
    await db.execute(
        delete(StopVote).where(
            StopVote.trip_id == trip_id,
            StopVote.suggestion_kind == kind,
            StopVote.target_id.in_(list(old_place)),
        )
    )
    if carried:
        await db.execute(insert(StopVote).values(carried).on_conflict_do_nothing())
