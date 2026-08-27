import math
import uuid
from datetime import date as date_type
from datetime import datetime, time
from typing import Any, Literal  # noqa: F401

from pydantic import BaseModel, computed_field, field_validator, model_validator


class WaypointCreate(BaseModel):
    address: str
    lat: float
    lng: float
    label: str | None = None
    stop_duration_minutes: int | None = None
    notes: str | None = None


class WaypointUpdate(BaseModel):
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    label: str | None = None
    stop_duration_minutes: int | None = None
    notes: str | None = None


class WaypointOut(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    position: int
    address: str
    lat: float
    lng: float
    label: str | None
    stop_duration_minutes: int | None
    notes: str | None
    drive_seconds_from_prev: int | None = None
    distance_meters_from_prev: int | None = None
    place_id: str | None = None
    itinerary_day_id: uuid.UUID | None = None
    scheduled_arrival_time: time | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TripCreate(BaseModel):
    title: str
    mode: Literal["point_to_point", "radius"]
    start_address: str
    start_lat: float
    start_lng: float
    # point_to_point fields
    end_address: str | None = None
    end_lat: float | None = None
    end_lng: float | None = None
    # radius fields
    max_drive_minutes: int | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_mode_fields(self) -> "TripCreate":
        if self.mode == "point_to_point":
            if self.end_address is None or self.end_lat is None or self.end_lng is None:
                raise ValueError("end_address, end_lat, and end_lng are required for point_to_point trips")
        elif self.mode == "radius":
            if self.max_drive_minutes is None:
                raise ValueError("max_drive_minutes is required for radius trips")
        return self


class TripUpdate(BaseModel):
    title: str | None = None
    status: Literal["draft", "planned", "completed"] | None = None
    start_address: str | None = None
    start_lat: float | None = None
    start_lng: float | None = None
    end_address: str | None = None
    end_lat: float | None = None
    end_lng: float | None = None
    max_drive_minutes: int | None = None
    notes: str | None = None
    start_date: date_type | None = None
    cover_image_url: str | None = None


class TripOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    mode: str
    status: str
    start_address: str
    start_lat: float
    start_lng: float
    end_address: str | None
    end_lat: float | None
    end_lng: float | None
    max_drive_minutes: int | None
    notes: str | None
    total_distance_meters: int | None = None
    total_drive_seconds: int | None = None
    route_polyline: str | None = None
    share_token: str | None = None
    is_public: bool = False
    start_date: date_type | None = None
    cover_image_url: str | None = None
    created_at: datetime
    updated_at: datetime
    waypoints: list[WaypointOut] = []

    model_config = {"from_attributes": True}


class RouteLeg(BaseModel):
    from_waypoint_id: str | None
    to_waypoint_id: str | None
    distance_meters: int | None
    drive_seconds: int | None


class RouteOut(BaseModel):
    trip_id: uuid.UUID
    total_distance_meters: int | None
    total_drive_seconds: int | None
    route_polyline: str | None
    legs: list[RouteLeg]


class GeocodeResult(BaseModel):
    address: str
    lat: float
    lng: float
    place_id: str | None = None


class TripListOut(BaseModel):
    id: uuid.UUID
    title: str
    mode: str
    status: str
    total_distance_meters: int | None = None
    total_drive_seconds: int | None = None
    cover_image_url: str | None = None
    start_date: date_type | None = None
    is_public: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PaginatedTrips(BaseModel):
    items: list[TripListOut]
    total: int
    page: int
    page_size: int


class RadiusSuggestionOut(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    category: str
    drive_seconds_from_start: int
    distance_meters_from_start: int
    rating: float | None
    user_ratings_total: int | None = None
    selected: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    # Computed on read rather than stored: this keeps quality_score always in sync
    # with the current scoring formula (in places.quality_score) even for
    # suggestions that were persisted before a formula change, without a migration.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def quality_score(self) -> float:
        if self.rating is None or not self.user_ratings_total:
            return 0.0
        return self.rating * math.log10(self.user_ratings_total + 1)


class RadiusDiscoverResponse(BaseModel):
    isochrone_geojson: dict[str, Any]
    suggestions: list[RadiusSuggestionOut]


class RadiusSelectRequest(BaseModel):
    suggestion_ids: list[uuid.UUID]
    generate_route: bool = False


class ReorderWaypointsRequest(BaseModel):
    ordered_ids: list[uuid.UUID]

    @field_validator("ordered_ids")
    @classmethod
    def no_duplicates(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(v) != len(set(v)):
            raise ValueError("Duplicate waypoint IDs in reorder request")
        return v


# ── Phase 5: Itinerary schemas ─────────────────────────────────────────────

class ItineraryWaypointOut(BaseModel):
    id: uuid.UUID
    label: str | None
    address: str
    position: int
    day_position: int | None
    scheduled_arrival_time: time | None
    drive_seconds_from_prev: int | None

    model_config = {"from_attributes": True}


class ItineraryDayOut(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    day_number: int
    date: date_type | None
    title: str | None
    notes: str | None
    waypoints: list[ItineraryWaypointOut] = []

    model_config = {"from_attributes": True}


class ItineraryOut(BaseModel):
    trip_id: uuid.UUID
    days: list[ItineraryDayOut]
    unscheduled_waypoints: list[ItineraryWaypointOut]


class ItineraryDayCreate(BaseModel):
    title: str | None = None
    date: date_type | None = None
    notes: str | None = None


class ItineraryDayUpdate(BaseModel):
    title: str | None = None
    date: date_type | None = None
    notes: str | None = None


class AssignWaypointsRequest(BaseModel):
    waypoint_ids: list[uuid.UUID]
    scheduled_arrival_time: time | None = None
    # Full ordered list of waypoint IDs for the destination day, used to set/update
    # day_position for every waypoint that ends up in this day (including ones not
    # in waypoint_ids, e.g. reordering existing members without reassigning them).
    ordered_waypoint_ids: list[uuid.UUID] | None = None


class SetArrivalTimeRequest(BaseModel):
    scheduled_arrival_time: time | None = None


class ShareOut(BaseModel):
    share_token: str
    share_url: str
    is_public: bool


# ── Phase 7: Corridor stops + radius itinerary builder ─────────────────────

class CorridorSuggestionOut(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    category: str
    rating: float | None
    user_ratings_total: int | None = None
    detour_seconds: int
    route_fraction: float
    selected: bool
    created_at: datetime

    model_config = {"from_attributes": True}

    # Computed on read rather than stored: this keeps quality_score always in sync
    # with the current scoring formula (in places.quality_score) even for
    # suggestions that were persisted before a formula change, without a migration.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def quality_score(self) -> float:
        if self.rating is None or not self.user_ratings_total:
            return 0.0
        return self.rating * math.log10(self.user_ratings_total + 1)


class CorridorDiscoverResponse(BaseModel):
    suggestions: list[CorridorSuggestionOut]
    max_detour_seconds: int


class CorridorSelectRequest(BaseModel):
    suggestion_ids: list[uuid.UUID]
    insert_as_waypoints: bool = False


class ItineraryBuildRequest(BaseModel):
    suggestion_ids: list[uuid.UUID]
    stop_duration_minutes: int = 30


class ItineraryBuildOut(BaseModel):
    trip_id: uuid.UUID
    waypoints: list[WaypointOut]
    total_drive_seconds: int
    total_stop_minutes: int
    total_trip_minutes: int
    budget_minutes: int
    within_budget: bool
    over_under_minutes: int
    dropped_suggestion_ids: list[uuid.UUID]


class PublicTripOut(BaseModel):
    id: uuid.UUID
    title: str
    mode: str
    start_address: str
    start_lat: float
    start_lng: float
    end_address: str | None
    end_lat: float | None
    end_lng: float | None
    total_distance_meters: int | None
    total_drive_seconds: int | None
    route_polyline: str | None
    start_date: date_type | None
    cover_image_url: str | None
    waypoints: list[WaypointOut] = []
    days: list[ItineraryDayOut] = []

    model_config = {"from_attributes": True}
