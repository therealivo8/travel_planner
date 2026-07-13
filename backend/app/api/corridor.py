import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import CorridorSuggestion, Trip, Waypoint
from app.schemas.trip import (
    CorridorDiscoverResponse,
    CorridorSelectRequest,
    CorridorSuggestionOut,
    TripOut,
)
from app.services import corridor as corridor_svc
from app.services import routes as route_svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["corridor"])
limiter = Limiter(key_func=get_remote_address)

DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_p2p_trip_with_route(trip_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Trip:
    result = await db.execute(
        select(Trip)
        .where(Trip.id == trip_id, Trip.user_id == user_id)
        .options(selectinload(Trip.waypoints), selectinload(Trip.corridor_suggestions))
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.mode != "point_to_point":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This endpoint is only available for point-to-point trips",
        )
    if trip.route_polyline is None or trip.total_drive_seconds is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Calculate a route for this trip before discovering corridor stops",
        )
    return trip


@router.post("/trips/{trip_id}/corridor/discover", response_model=CorridorDiscoverResponse)
@limiter.limit("3/hour")
async def discover_corridor(
    request: Request,
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    categories: list[str] | None = Query(None),
    max_detour_minutes: int = Query(15, ge=1, le=60),
) -> CorridorDiscoverResponse:
    trip = await _get_p2p_trip_with_route(trip_id, current_user.id, db)
    assert trip.end_lat is not None and trip.end_lng is not None
    assert trip.route_polyline is not None and trip.total_drive_seconds is not None

    try:
        suggestions = corridor_svc.discover_corridor_suggestions(
            origin_lat=float(trip.start_lat),
            origin_lng=float(trip.start_lng),
            dest_lat=float(trip.end_lat),
            dest_lng=float(trip.end_lng),
            route_polyline=trip.route_polyline,
            direct_drive_seconds=trip.total_drive_seconds,
            max_detour_minutes=max_detour_minutes,
            categories=categories or None,
            limit=50,
        )
    except ValueError as exc:
        logger.exception("Corridor discovery ValueError")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Corridor discovery failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Corridor discovery failed: {exc}",
        ) from exc

    await db.execute(delete(CorridorSuggestion).where(CorridorSuggestion.trip_id == trip_id))

    new_suggestions: list[CorridorSuggestion] = []
    for s in suggestions:
        suggestion = CorridorSuggestion(
            trip_id=trip_id,
            place_id=s["place_id"],
            name=s["name"],
            address=s["address"],
            lat=s["lat"],
            lng=s["lng"],
            category=s["category"],
            rating=s["rating"],
            detour_seconds=s["detour_seconds"],
            route_fraction=s["route_fraction"],
            selected=False,
        )
        db.add(suggestion)
        new_suggestions.append(suggestion)

    await db.commit()
    for sg in new_suggestions:
        await db.refresh(sg)

    return CorridorDiscoverResponse(
        suggestions=[CorridorSuggestionOut.model_validate(sg) for sg in new_suggestions],
        max_detour_seconds=max_detour_minutes * 60,
    )


@router.get("/trips/{trip_id}/corridor/suggestions", response_model=CorridorDiscoverResponse)
async def get_corridor_suggestions(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> CorridorDiscoverResponse:
    await _get_p2p_trip_with_route(trip_id, current_user.id, db)

    result = await db.execute(
        select(CorridorSuggestion)
        .where(CorridorSuggestion.trip_id == trip_id)
        .order_by(CorridorSuggestion.detour_seconds)
    )
    suggestions = result.scalars().all()

    max_detour_seconds = max((s.detour_seconds for s in suggestions), default=0)

    return CorridorDiscoverResponse(
        suggestions=[CorridorSuggestionOut.model_validate(sg) for sg in suggestions],
        max_detour_seconds=max_detour_seconds,
    )


@router.post("/trips/{trip_id}/corridor/select", response_model=TripOut)
@limiter.limit("20/hour")
async def select_corridor_suggestions(
    request: Request,
    trip_id: uuid.UUID,
    body: CorridorSelectRequest,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = await _get_p2p_trip_with_route(trip_id, current_user.id, db)
    assert trip.end_lat is not None and trip.end_lng is not None

    result = await db.execute(
        select(CorridorSuggestion).where(
            CorridorSuggestion.trip_id == trip_id,
            CorridorSuggestion.id.in_(body.suggestion_ids),
        )
    )
    suggestions = result.scalars().all()

    if len(suggestions) != len(body.suggestion_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more suggestion IDs not found for this trip",
        )

    for sg in trip.corridor_suggestions:
        sg.selected = False

    selected_suggestions = sorted(suggestions, key=lambda s: s.route_fraction)
    for sg in selected_suggestions:
        sg.selected = True

    if body.insert_as_waypoints:
        existing_waypoints = sorted(trip.waypoints, key=lambda w: w.position)

        # Simple case: no manual waypoints yet — just place selected stops in route order.
        # (Interleaving with pre-existing manual waypoints by route position is a known
        # rough edge for a later pass; for now new stops are appended after existing ones.)
        new_stops = [
            Waypoint(
                trip_id=trip_id,
                position=0,  # reassigned below
                address=sg.address,
                lat=sg.lat,
                lng=sg.lng,
                label=sg.name,
                place_id=sg.place_id,
            )
            for sg in selected_suggestions
        ]

        if existing_waypoints:
            ordered = existing_waypoints + new_stops
        else:
            ordered = new_stops

        for wp in new_stops:
            db.add(wp)
        for pos, wp in enumerate(ordered):
            wp.position = pos

        await db.flush()

        waypoint_coords = [(float(w.lat), float(w.lng)) for w in ordered]

        try:
            route_result = route_svc.calculate_route(
                origin_lat=float(trip.start_lat),
                origin_lng=float(trip.start_lng),
                dest_lat=float(trip.end_lat),
                dest_lng=float(trip.end_lng),
                waypoint_coords=waypoint_coords,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

        trip.total_distance_meters = route_result["total_distance_meters"]
        trip.total_drive_seconds = route_result["total_drive_seconds"]
        trip.route_polyline = route_result["route_polyline"]
        trip.route_raw_response = route_result["raw_response"]

        legs = route_result["legs"]
        for i, wp in enumerate(ordered):
            if i < len(legs):
                wp.drive_seconds_from_prev = legs[i]["drive_seconds"]
                wp.distance_meters_from_prev = legs[i]["distance_meters"]

    await db.commit()
    db.expire_all()

    final = await db.execute(
        select(Trip).where(Trip.id == trip_id).options(selectinload(Trip.waypoints))
    )
    return TripOut.model_validate(final.scalar_one())


@router.delete(
    "/trips/{trip_id}/corridor/suggestions/{suggestion_id}/select",
    response_model=CorridorSuggestionOut,
)
async def deselect_corridor_suggestion(
    trip_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> CorridorSuggestionOut:
    await _get_p2p_trip_with_route(trip_id, current_user.id, db)

    result = await db.execute(
        select(CorridorSuggestion).where(
            CorridorSuggestion.id == suggestion_id,
            CorridorSuggestion.trip_id == trip_id,
        )
    )
    suggestion = result.scalar_one_or_none()
    if suggestion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found")

    suggestion.selected = False

    wp_result = await db.execute(
        select(Waypoint).where(
            Waypoint.trip_id == trip_id,
            Waypoint.place_id == suggestion.place_id,
        )
    )
    wp = wp_result.scalar_one_or_none()
    if wp:
        deleted_pos = wp.position
        await db.delete(wp)
        remaining = await db.execute(
            select(Waypoint).where(
                Waypoint.trip_id == trip_id,
                Waypoint.position > deleted_pos,
            ).order_by(Waypoint.position)
        )
        for remaining_wp in remaining.scalars().all():
            remaining_wp.position -= 1

    await db.commit()
    await db.refresh(suggestion)
    return CorridorSuggestionOut.model_validate(suggestion)
