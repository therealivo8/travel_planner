import xml.etree.ElementTree as ET
from datetime import date, time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

from icalendar import Calendar

from app.services import costs, navigation, weather
from app.services.export_formats import build_gpx, build_ics, effective_day_date
from app.services.packing_templates import TEMPLATES


def test_fuel_estimate_matches_prd_example() -> None:
    # 500 miles at 25 MPG and $4.00/gal = 20 gal * $4 = $80.00
    assert costs.fuel_estimate(500 * costs.METERS_PER_MILE, 25, 4.0) == 80.0
    assert costs.fuel_estimate(500 * costs.METERS_PER_MILE, 50, 4.0) == 40.0
    assert costs.fuel_estimate(None, 25, 4.0) == 0.0


def pt(i: int, pid: str | None = None) -> navigation.Point:
    return navigation.Point(40.0 + i / 100, -74.0, pid, f"stop {i}")


def test_four_stops_make_one_ordered_google_link() -> None:
    stops = [pt(i, f"pid{i}") for i in range(1, 5)]
    links = navigation.google_links(pt(0), stops)
    assert len(links) == 1
    q = parse_qs(urlparse(links[0]["url"]).query)
    assert q["origin"] == [pt(0).coords]
    assert q["destination"] == [stops[-1].coords]
    assert q["waypoints"] == ["|".join(s.coords for s in stops[:3])]
    assert q["waypoint_place_ids"] == ["pid1|pid2|pid3"]
    assert q["destination_place_id"] == ["pid4"]


def test_twelve_stops_split_and_cover_every_stop_in_order() -> None:
    stops = [pt(i) for i in range(1, 13)]
    links = navigation.google_links(pt(0), stops)
    assert len(links) == 2
    assert [link["label"] for link in links] == ["Part 1 of 2", "Part 2 of 2"]
    covered: list[str] = []
    for link in links:
        q = parse_qs(urlparse(link["url"]).query)
        assert len(q.get("waypoints", [""])[0].split("|")) <= navigation.GOOGLE_MAX_WAYPOINTS
        covered += q.get("waypoints", [""])[0].split("|") if "waypoints" in q else []
        covered.append(q["destination"][0])
    assert covered == [s.coords for s in stops]
    # Part 2 picks up where part 1 ended.
    assert parse_qs(urlparse(links[1]["url"]).query)["origin"] == [stops[9].coords]


def test_place_ids_omitted_unless_every_waypoint_has_one() -> None:
    stops = [pt(1, "a"), pt(2, None), pt(3, "c")]
    q = parse_qs(urlparse(navigation.google_links(pt(0), stops)[0]["url"]).query)
    assert "waypoint_place_ids" not in q
    assert q["destination_place_id"] == ["c"]


def test_apple_links_one_per_leg() -> None:
    links = navigation.apple_links(pt(0), [pt(1), pt(2)])
    assert len(links) == 2
    assert parse_qs(urlparse(links[1]["url"]).query)["saddr"] == [pt(1).coords]


def test_after_dark() -> None:
    sunset = "2026-10-10T18:12"
    assert weather.arrives_after_dark(time(17, 30), 60, sunset)
    assert not weather.arrives_after_dark(time(16, 0), 60, sunset)
    assert not weather.arrives_after_dark(None, 60, sunset)
    assert not weather.arrives_after_dark(time(23, 0), 60, None)


def test_is_wet() -> None:
    assert weather.is_wet({"precip_pct": 70, "code": 3})
    assert weather.is_wet({"precip_pct": 10, "code": 61})
    assert not weather.is_wet({"precip_pct": 10, "code": 1})


def test_templates_have_no_internal_duplicates() -> None:
    assert {"Essentials", "Camping", "Beach", "Cold weather", "Kids", "Pets"} <= set(TEMPLATES)
    for items in TEMPLATES.values():
        labels = [label.lower() for _, label in items]
        assert len(labels) == len(set(labels))


def _trip() -> SimpleNamespace:
    wp1 = SimpleNamespace(id="w1", lat=40.1, lng=-74.1, label="Diner", address="1 Main St", place_id="p1",
             position=0, day_position=0, scheduled_arrival_time=time(12, 30),
             stop_duration_minutes=45)  # fmt: skip
    wp2 = SimpleNamespace(id="w2", lat=40.2, lng=-74.2, label=None, address="2 Oak Ave", place_id=None,
             position=1, day_position=1, scheduled_arrival_time=None,
             stop_duration_minutes=None)  # fmt: skip
    day = SimpleNamespace(id="d1", day_number=2, date=None, title="Coast", notes="Bring snacks",
             waypoints=[wp1, wp2])  # fmt: skip
    return SimpleNamespace(
        title="Trip", timezone="America/New_York", start_date=date(2026, 10, 10),
        itinerary_days=[day], waypoints=[wp1, wp2], start_lat=40.0, start_lng=-74.0,
        start_address="Home", end_lat=40.3, end_lng=-74.3, end_address="Away",
        route_polyline="_p~iF~ps|U_ulLnnqC_mqNvxq`@",
    )  # fmt: skip


def test_ics_has_all_day_event_and_timed_stop_with_timezone() -> None:
    trip = _trip()
    assert effective_day_date(trip, trip.itinerary_days[0]) == date(2026, 10, 11)  # type: ignore[arg-type]
    cal = Calendar.from_ical(build_ics(trip))  # type: ignore[arg-type]
    events = list(cal.walk("VEVENT"))
    assert len(events) == 2  # the stop without an arrival time gets no event
    all_day = next(e for e in events if e["uid"].startswith("day-"))
    assert all_day["dtstart"].dt == date(2026, 10, 11)
    assert all_day["dtend"].dt == date(2026, 10, 12)
    stop = next(e for e in events if e["uid"].startswith("stop-"))
    start, end = stop["dtstart"].dt, stop["dtend"].dt
    assert (start.hour, start.minute) == (12, 30)
    assert str(start.tzinfo) == "America/New_York"
    assert (end - start).total_seconds() == 45 * 60
    assert str(stop["location"]) == "1 Main St"
    assert "google.com/maps" in str(stop["description"])


def test_gpx_has_pins_route_and_track() -> None:
    root = ET.fromstring(build_gpx(_trip()))  # type: ignore[arg-type]
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    assert len(root.findall("g:wpt", ns)) == 4
    assert len(root.findall("g:rte/g:rtept", ns)) == 4
    assert len(root.findall("g:trk/g:trkseg/g:trkpt", ns)) == 3  # Google's 3-point sample
