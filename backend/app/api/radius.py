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
from app.models.trip import RadiusSuggestion, Trip, Waypoint
from app.schemas.trip import (
    ItineraryBuildOut,
    ItineraryBuildRequest,
    RadiusDiscoverResponse,
    RadiusSelectRequest,
    RadiusSuggestionOut,
    TripOut,
    WaypointOut,
)
from app.services import itinerary_builder
from app.services import radius as radius_svc
from app.services import routes as route_svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["radius"])
limiter = Limiter(key_func=get_remote_address)

BUDGET_MULTIPLIER = 2  # round-trip budget = max_drive_minutes * BUDGET_MULTIPLIER

DB = Annotated[AsyncSession, Depends(get_db)]


async def _get_radius_trip(trip_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Trip:
    result = await db.execute(
        select(Trip)
        .where(Trip.id == trip_id, Trip.user_id == user_id)
        .options(selectinload(Trip.waypoints), selectinload(Trip.radius_suggestions))
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    if trip.mode != "radius":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This endpoint is only available for radius mode trips",
        )
    return trip


@router.post("/trips/{trip_id}/radius/discover", response_model=RadiusDiscoverResponse)
@limiter.limit("3/hour")
async def discover(
    request: Request,
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    categories: list[str] | None = Query(None),
) -> RadiusDiscoverResponse:
    trip = await _get_radius_trip(trip_id, current_user.id, db)

    if trip.max_drive_minutes is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="max_drive_minutes is not set on this trip",
        )

    try:
        result = radius_svc.discover_suggestions(
            origin_lat=float(trip.start_lat),
            origin_lng=float(trip.start_lng),
            max_drive_minutes=trip.max_drive_minutes,
            categories=categories or None,
            limit=50,
        )
    except ValueError as exc:
        logger.exception("Discovery ValueError")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Discovery failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Discovery failed: {exc}",
        ) from exc

    # Clear old suggestions before re-inserting
    await db.execute(delete(RadiusSuggestion).where(RadiusSuggestion.trip_id == trip_id))

    # Cache isochrone on the trip
    trip.radius_isochrone_geojson = result["isochrone_geojson"]

    new_suggestions: list[RadiusSuggestion] = []
    for s in result["suggestions"]:
        suggestion = RadiusSuggestion(
            trip_id=trip_id,
            place_id=s["place_id"],
            name=s["name"],
            address=s["address"],
            lat=s["lat"],
            lng=s["lng"],
            category=s["category"],
            drive_seconds_from_start=s["drive_seconds_from_start"],
            distance_meters_from_start=s["distance_meters_from_start"],
            rating=s["rating"],
            selected=False,
        )
        db.add(suggestion)
        new_suggestions.append(suggestion)

    await db.commit()
    await db.refresh(trip)
    for sg in new_suggestions:
        await db.refresh(sg)

    return RadiusDiscoverResponse(
        isochrone_geojson=trip.radius_isochrone_geojson,
        suggestions=[RadiusSuggestionOut.model_validate(sg) for sg in new_suggestions],
    )


@router.get("/trips/{trip_id}/radius/suggestions", response_model=RadiusDiscoverResponse)
async def get_suggestions(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> RadiusDiscoverResponse:
    trip = await _get_radius_trip(trip_id, current_user.id, db)

    result = await db.execute(
        select(RadiusSuggestion)
        .where(RadiusSuggestion.trip_id == trip_id)
        .order_by(RadiusSuggestion.drive_seconds_from_start)
    )
    suggestions = result.scalars().all()

    return RadiusDiscoverResponse(
        isochrone_geojson=trip.radius_isochrone_geojson or {},
        suggestions=[RadiusSuggestionOut.model_validate(sg) for sg in suggestions],
    )


@router.post("/trips/{trip_id}/radius/select", response_model=TripOut)
@limiter.limit("20/hour")
async def select_suggestions(
    request: Request,
    trip_id: uuid.UUID,
    body: RadiusSelectRequest,
    current_user: CurrentUser,
    db: DB,
) -> TripOut:
    trip = await _get_radius_trip(trip_id, current_user.id, db)

    # Load requested suggestions and mark selected
    result = await db.execute(
        select(RadiusSuggestion).where(
            RadiusSuggestion.trip_id == trip_id,
            RadiusSuggestion.id.in_(body.suggestion_ids),
        )
    )
    suggestions = result.scalars().all()

    if len(suggestions) != len(body.suggestion_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more suggestion IDs not found for this trip",
        )

    # Deselect all first, then select requested ones
    for sg in trip.radius_suggestions:
        sg.selected = False

    selected_suggestions = sorted(suggestions, key=lambda s: s.drive_seconds_from_start)
    for sg in selected_suggestions:
        sg.selected = True

    if body.generate_route:
        # Remove existing waypoints
        await db.execute(delete(Waypoint).where(Waypoint.trip_id == trip_id))
        await db.flush()

        # Create waypoints from selected suggestions, ordered by drive time
        for pos, sg in enumerate(selected_suggestions):
            wp = Waypoint(
                trip_id=trip_id,
                position=pos,
                address=sg.address,
                lat=sg.lat,
                lng=sg.lng,
                label=sg.name,
                place_id=sg.place_id,
            )
            db.add(wp)

        await db.commit()

        # Reload trip with fresh waypoints
        refreshed = await db.execute(
            select(Trip).where(Trip.id == trip_id).options(selectinload(Trip.waypoints))
        )
        trip = refreshed.scalar_one()
        ordered_wps = sorted(trip.waypoints, key=lambda w: w.position)
        waypoint_coords = [(float(w.lat), float(w.lng)) for w in ordered_wps]

        # Round-trip: start → stops → start
        try:
            route_result = route_svc.calculate_route(
                origin_lat=float(trip.start_lat),
                origin_lng=float(trip.start_lng),
                dest_lat=float(trip.start_lat),
                dest_lng=float(trip.start_lng),
                waypoint_coords=waypoint_coords,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

        trip.total_distance_meters = route_result["total_distance_meters"]
        trip.total_drive_seconds = route_result["total_drive_seconds"]
        trip.route_polyline = route_result["route_polyline"]
        trip.route_raw_response = route_result["raw_response"]

        legs = route_result["legs"]
        for i, wp in enumerate(ordered_wps):
            if i < len(legs):
                wp.drive_seconds_from_prev = legs[i]["drive_seconds"]
                wp.distance_meters_from_prev = legs[i]["distance_meters"]

    await db.commit()

    final = await db.execute(
        select(Trip).where(Trip.id == trip_id).options(selectinload(Trip.waypoints))
    )
    return TripOut.model_validate(final.scalar_one())


@router.post("/trips/{trip_id}/radius/build-itinerary", response_model=ItineraryBuildOut)
@limiter.limit("10/hour")
async def build_itinerary(
    request: Request,
    trip_id: uuid.UUID,
    body: ItineraryBuildRequest,
    current_user: CurrentUser,
    db: DB,
) -> ItineraryBuildOut:
    trip = await _get_radius_trip(trip_id, current_user.id, db)

    if trip.max_drive_minutes is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="max_drive_minutes is not set on this trip",
        )

    result = await db.execute(
        select(RadiusSuggestion).where(
            RadiusSuggestion.trip_id == trip_id,
            RadiusSuggestion.id.in_(body.suggestion_ids),
        )
    )
    suggestions = result.scalars().all()
    if len(suggestions) != len(body.suggestion_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more suggestion IDs not found for this trip",
        )

    budget_minutes = trip.max_drive_minutes * BUDGET_MULTIPLIER

    try:
        build_result = itinerary_builder.build_ordered_itinerary(
            origin=(float(trip.start_lat), float(trip.start_lng)),
            stops=[
                {
                    "id": sg.id,
                    "lat": float(sg.lat),
                    "lng": float(sg.lng),
                    "stop_duration_minutes": body.stop_duration_minutes,
                }
                for sg in suggestions
            ],
            budget_minutes=budget_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    kept_ids = set(build_result["ordered_stop_ids"])
    dropped_ids = set(build_result["dropped_stop_ids"])
    suggestions_by_id = {sg.id: sg for sg in suggestions}

    for sg in trip.radius_suggestions:
        sg.selected = sg.id in kept_ids

    # Rebuild waypoints in optimized order
    await db.execute(delete(Waypoint).where(Waypoint.trip_id == trip_id))
    await db.flush()

    ordered_suggestions = [suggestions_by_id[sid] for sid in build_result["ordered_stop_ids"]]
    for pos, sg in enumerate(ordered_suggestions):
        wp = Waypoint(
            trip_id=trip_id,
            position=pos,
            address=sg.address,
            lat=sg.lat,
            lng=sg.lng,
            label=sg.name,
            place_id=sg.place_id,
            stop_duration_minutes=body.stop_duration_minutes,
        )
        db.add(wp)

    await db.flush()

    waypoint_coords = [(float(sg.lat), float(sg.lng)) for sg in ordered_suggestions]

    try:
        route_result = route_svc.calculate_route(
            origin_lat=float(trip.start_lat),
            origin_lng=float(trip.start_lng),
            dest_lat=float(trip.start_lat),
            dest_lng=float(trip.start_lng),
            waypoint_coords=waypoint_coords,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    trip.total_distance_meters = route_result["total_distance_meters"]
    trip.total_drive_seconds = route_result["total_drive_seconds"]
    trip.route_polyline = route_result["route_polyline"]
    trip.route_raw_response = route_result["raw_response"]

    db.expire_all()
    refreshed = await db.execute(
        select(Trip).where(Trip.id == trip_id).options(selectinload(Trip.waypoints))
    )
    trip = refreshed.scalar_one()
    ordered_wps = sorted(trip.waypoints, key=lambda w: w.position)
    legs = route_result["legs"]
    for i, wp in enumerate(ordered_wps):
        if i < len(legs):
            wp.drive_seconds_from_prev = legs[i]["drive_seconds"]
            wp.distance_meters_from_prev = legs[i]["distance_meters"]

    await db.commit()
    db.expire_all()

    final = await db.execute(
        select(Trip).where(Trip.id == trip_id).options(selectinload(Trip.waypoints))
    )
    final_trip = final.scalar_one()
    final_waypoints = sorted(final_trip.waypoints, key=lambda w: w.position)

    total_drive_seconds = final_trip.total_drive_seconds or 0
    total_stop_minutes = build_result["total_stop_minutes"]
    total_trip_minutes = total_drive_seconds // 60 + total_stop_minutes
    over_under_minutes = total_trip_minutes - budget_minutes

    # If every selected stop had to be dropped to fit, there's no usable itinerary —
    # report this as over budget (using the cheapest single stop's round-trip cost as
    # the reference) rather than a trivially-fitting empty itinerary.
    no_stops_kept = len(suggestions) > 0 and len(kept_ids) == 0
    if no_stops_kept:
        within_budget = False
        cheapest_minutes = build_result["cheapest_single_stop_minutes"]
        over_under_minutes = cheapest_minutes - budget_minutes
    else:
        within_budget = over_under_minutes <= 0

    return ItineraryBuildOut(
        trip_id=trip_id,
        waypoints=[WaypointOut.model_validate(w) for w in final_waypoints],
        total_drive_seconds=total_drive_seconds,
        total_stop_minutes=total_stop_minutes,
        total_trip_minutes=total_trip_minutes,
        budget_minutes=budget_minutes,
        within_budget=within_budget,
        over_under_minutes=over_under_minutes,
        dropped_suggestion_ids=list(dropped_ids),
    )


@router.delete(
    "/trips/{trip_id}/radius/suggestions/{suggestion_id}/select",
    response_model=RadiusSuggestionOut,
)
async def deselect_suggestion(
    trip_id: uuid.UUID,
    suggestion_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> RadiusSuggestionOut:
    await _get_radius_trip(trip_id, current_user.id, db)

    result = await db.execute(
        select(RadiusSuggestion).where(
            RadiusSuggestion.id == suggestion_id,
            RadiusSuggestion.trip_id == trip_id,
        )
    )
    suggestion = result.scalar_one_or_none()
    if suggestion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found")

    suggestion.selected = False

    # Remove the corresponding waypoint if it exists
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
    return RadiusSuggestionOut.model_validate(suggestion)
