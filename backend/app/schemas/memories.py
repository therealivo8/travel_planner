import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

PhotoContentType = Literal["image/webp", "image/jpeg", "image/png"]


class UploadUrlRequest(BaseModel):
    content_type: PhotoContentType
    bytes: int = Field(gt=0)
    width: int = Field(gt=0, le=10000)
    height: int = Field(gt=0, le=10000)
    waypoint_id: uuid.UUID | None = None
    itinerary_day_id: uuid.UUID | None = None


class UploadUrlOut(BaseModel):
    object_key: str
    upload_url: str
    # Headers the browser must send with the PUT; they are part of the signature.
    headers: dict[str, str]


class PhotoConfirm(BaseModel):
    object_key: str = Field(max_length=300)
    width: int = Field(gt=0, le=10000)
    height: int = Field(gt=0, le=10000)
    bytes: int = Field(gt=0)
    caption: str | None = Field(default=None, max_length=300)
    taken_at: datetime | None = None
    waypoint_id: uuid.UUID | None = None
    itinerary_day_id: uuid.UUID | None = None


class PhotoUpdate(BaseModel):
    caption: str | None = Field(default=None, max_length=300)


class PhotoOut(BaseModel):
    id: uuid.UUID
    waypoint_id: uuid.UUID | None
    itinerary_day_id: uuid.UUID | None
    width: int
    height: int
    caption: str | None
    taken_at: datetime | None
    url: str


class CheckInRequest(BaseModel):
    action: Literal["arrived", "skipped", "undo"]
    # When the user actually did it. Offline check-ins are replayed later, so the client
    # supplies the original time.
    at: datetime | None = None


class RecapStop(BaseModel):
    id: uuid.UUID
    label: str | None
    address: str
    visited: bool
    skipped: bool
    visited_at: datetime | None
    notes: str | None
    photos: list[PhotoOut] = []


class RecapDay(BaseModel):
    id: uuid.UUID
    day_number: int
    date: date | None
    title: str | None
    notes: str | None
    stops: list[RecapStop]
    photos: list[PhotoOut] = []


class RecapOut(BaseModel):
    title: str
    total_distance_meters: int | None
    total_drive_seconds: int | None
    days_count: int
    stops_planned: int
    stops_visited: int
    stops_skipped: int
    photo_count: int
    # Private to the owner: omitted from the public share view.
    spent_by_category: dict[str, float] | None = None
    spent_total: float | None = None
    currency: str | None = None
    days: list[RecapDay]


class MapStop(BaseModel):
    lat: float
    lng: float
    label: str | None


class MapTrip(BaseModel):
    id: uuid.UUID
    title: str
    year: int
    route_polyline: str
    total_distance_meters: int | None
    stops_count: int
    visited_stops: list[MapStop]


class MapStats(BaseModel):
    trips: int
    total_distance_meters: int
    stops_visited: int
    longest_trip_title: str | None
    longest_trip_distance_meters: int | None


class MyMapOut(BaseModel):
    years: list[int]
    stats: MapStats
    trips: list[MapTrip]
