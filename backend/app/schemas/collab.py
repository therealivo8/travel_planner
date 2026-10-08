import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

MemberRole = Literal["editor", "viewer"]


class MemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    role: Literal["owner", "editor", "viewer"]
    is_you: bool
    joined_at: datetime | None


class MemberUpdate(BaseModel):
    role: MemberRole


class InviteCreate(BaseModel):
    role: MemberRole
    email: EmailStr | None = None


class InviteOut(BaseModel):
    id: uuid.UUID
    role: MemberRole
    expires_at: datetime
    max_uses: int
    uses: int


class InviteCreated(InviteOut):
    # The raw token appears only here, once; only its hash is stored.
    url: str
    emailed: bool = False


class InvitePreview(BaseModel):
    valid: bool
    trip_title: str | None = None
    owner_name: str | None = None
    role: MemberRole | None = None


class InviteAccepted(BaseModel):
    trip_id: uuid.UUID
    role: Literal["owner", "editor", "viewer"]


VoteKind = Literal["radius", "corridor", "waypoint"]


class VoteIn(BaseModel):
    kind: VoteKind
    target_id: uuid.UUID
    value: Literal[-1, 0, 1]  # 0 clears the vote


class Voter(BaseModel):
    user_id: uuid.UUID
    name: str
    value: int


class VoteTally(BaseModel):
    up: int = 0
    down: int = 0
    mine: int = 0
    voters: list[Voter] = []


CommentKind = Literal["trip", "day", "waypoint"]


class CommentCreate(BaseModel):
    target_kind: CommentKind
    target_id: uuid.UUID | None = None
    body: str = Field(min_length=1, max_length=1000)


class CommentUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=1000)


class CommentOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    author: str
    body: str  # plain text; empty once deleted
    created_at: datetime
    edited_at: datetime | None
    deleted: bool
    mine: bool


class ActivityOut(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    kind: str
    summary: str
    created_at: datetime


class ChangesOut(BaseModel):
    version: int
    changed: bool
    activity: list[ActivityOut] = []


class NotificationItem(ActivityOut):
    trip_title: str


class NotificationsOut(BaseModel):
    unread: int
    items: list[NotificationItem]
