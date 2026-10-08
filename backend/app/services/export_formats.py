"""Calendar (.ics) and GPX exports (Phase 16, Part E). Pure functions over ORM objects:
no API is called."""

import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import polyline as polyline_codec
from icalendar import Calendar, Event

from app.models.trip import ItineraryDay, Trip
from app.services.navigation import day_stops

DEFAULT_STOP_MINUTES = 30


def effective_day_date(trip: Trip, day: ItineraryDay) -> date | None:
    """The day's own date, else derived from the trip's start date."""
    if day.date is not None:
        return day.date
    if trip.start_date is not None:
        return trip.start_date + timedelta(days=day.day_number - 1)
    return None


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _stop_url(lat: float, lng: float, place_id: str | None) -> str:
    url = f"https://www.google.com/maps/search/?api=1&query={lat:.6f},{lng:.6f}"
    return url + f"&query_place_id={place_id}" if place_id else url


def build_ics(trip: Trip) -> bytes:
    cal = Calendar()
    cal.add("prodid", "-//Road Trip Planner//EN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", trip.title)
    tz = _zone(trip.timezone)
    stamp = datetime.now(UTC)

    for day in sorted(trip.itinerary_days, key=lambda d: d.day_number):
        day_date = effective_day_date(trip, day)
        if day_date is None:
            continue

        all_day = Event()
        all_day.add("uid", f"day-{day.id}@roadtrip-planner")
        all_day.add("dtstamp", stamp)
        all_day.add("summary", f"Day {day.day_number}: {day.title}" if day.title else f"Day {day.day_number}")
        all_day.add("dtstart", day_date)
        all_day.add("dtend", day_date + timedelta(days=1))
        if day.notes:
            all_day.add("description", day.notes)
        cal.add_component(all_day)

        for wp in day_stops(day.waypoints):
            if wp.scheduled_arrival_time is None:
                continue
            start = datetime.combine(day_date, wp.scheduled_arrival_time, tzinfo=tz)
            event = Event()
            event.add("uid", f"stop-{wp.id}@roadtrip-planner")
            event.add("dtstamp", stamp)
            event.add("summary", wp.label or wp.address)
            event.add("dtstart", start)
            event.add(
                "dtend", start + timedelta(minutes=wp.stop_duration_minutes or DEFAULT_STOP_MINUTES)
            )
            event.add("location", wp.address)
            event.add("description", _stop_url(float(wp.lat), float(wp.lng), wp.place_id))
            cal.add_component(event)

    return bytes(cal.to_ical())


GPX_NS = "http://www.topografix.com/GPX/1/1"


def build_gpx(trip: Trip) -> bytes:
    """Waypoints (pins), a route through the stops, and a track from the stored polyline."""
    ET.register_namespace("", GPX_NS)
    root = ET.Element(
        f"{{{GPX_NS}}}gpx", {"version": "1.1", "creator": "Road Trip Planner"}
    )
    meta = ET.SubElement(root, f"{{{GPX_NS}}}metadata")
    ET.SubElement(meta, f"{{{GPX_NS}}}name").text = trip.title

    stops: list[tuple[float, float, str]] = [
        (float(trip.start_lat), float(trip.start_lng), trip.start_address)
    ]
    stops += [
        (float(w.lat), float(w.lng), w.label or w.address)
        for w in sorted(trip.waypoints, key=lambda w: w.position)
    ]
    if trip.end_lat is not None and trip.end_lng is not None:
        stops.append((float(trip.end_lat), float(trip.end_lng), trip.end_address or "Destination"))

    # <wpt> first (schema order): most viewers only draw pins for these, not route points.
    for lat, lng, name in stops:
        wpt = ET.SubElement(root, f"{{{GPX_NS}}}wpt", {"lat": f"{lat:.6f}", "lon": f"{lng:.6f}"})
        ET.SubElement(wpt, f"{{{GPX_NS}}}name").text = name

    rte = ET.SubElement(root, f"{{{GPX_NS}}}rte")
    ET.SubElement(rte, f"{{{GPX_NS}}}name").text = trip.title
    for lat, lng, name in stops:
        pt = ET.SubElement(rte, f"{{{GPX_NS}}}rtept", {"lat": f"{lat:.6f}", "lon": f"{lng:.6f}"})
        ET.SubElement(pt, f"{{{GPX_NS}}}name").text = name

    if trip.route_polyline:
        trk = ET.SubElement(root, f"{{{GPX_NS}}}trk")
        ET.SubElement(trk, f"{{{GPX_NS}}}name").text = f"{trip.title} (route)"
        seg = ET.SubElement(trk, f"{{{GPX_NS}}}trkseg")
        for lat, lng in polyline_codec.decode(trip.route_polyline):
            ET.SubElement(seg, f"{{{GPX_NS}}}trkpt", {"lat": f"{lat:.6f}", "lon": f"{lng:.6f}"})

    ET.indent(root)
    return bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
