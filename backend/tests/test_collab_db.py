"""Phase 19: access roles, invites, votes, comments, optimistic concurrency, notifications."""

import asyncio
import logging
import os
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import select, text, update

from app.db.session import AsyncSessionLocal
from app.models.collab import TripInvite, TripMember
from app.models.trip import CorridorSuggestion, ItineraryDay, RadiusSuggestion, Trip, Waypoint
from app.models.user import User
from app.services import corridor as corridor_svc
from tests.helpers import auth, make_user

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DB_TESTS") != "1", reason="set RUN_DB_TESTS=1 with a migrated DATABASE_URL"
)

POLY = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


class Cast:
    """An owner, a trip with one stop/day/radius+corridor suggestion, and helpers to add members."""

    owner: User
    trip: Trip
    wp: uuid.UUID
    day: uuid.UUID
    radius_sg: uuid.UUID
    corridor_sg: uuid.UUID


async def setup_trip(client: httpx.AsyncClient, mode: str = "point_to_point") -> Cast:
    c = Cast()
    c.owner = await make_user("owner@example.com")
    async with AsyncSessionLocal() as db:
        trip = Trip(
            user_id=c.owner.id, title="Group trip", mode=mode, start_address="A", start_lat=40,
            start_lng=-74, end_address="B", end_lat=41, end_lng=-75, route_polyline=POLY,
            total_distance_meters=300_000, total_drive_seconds=12_000, max_drive_minutes=None,
        )  # fmt: skip
        db.add(trip)
        await db.flush()
        day = ItineraryDay(trip_id=trip.id, day_number=1)
        db.add(day)
        await db.flush()
        wp = Waypoint(trip_id=trip.id, position=0, address="1 St", lat=40.1, lng=-74, label="Diner",
                      itinerary_day_id=day.id, day_position=0)  # fmt: skip
        rs = RadiusSuggestion(trip_id=trip.id, place_id="pid-r", name="Park", address="a", lat=1, lng=1,
                              category="park", drive_seconds_from_start=1, distance_meters_from_start=1)  # fmt: skip
        cs = CorridorSuggestion(trip_id=trip.id, place_id="pid-c", name="Lake", address="a", lat=1, lng=1,
                                category="park", detour_seconds=60, route_fraction=0.5)  # fmt: skip
        db.add_all([wp, rs, cs])
        await db.commit()
        c.trip, c.wp, c.day, c.radius_sg, c.corridor_sg = trip, wp.id, day.id, rs.id, cs.id
    return c


async def add_member(cast: Cast, email: str, role: str) -> User:
    user = await make_user(email)
    async with AsyncSessionLocal() as db:
        db.add(TripMember(trip_id=cast.trip.id, user_id=user.id, role=role))
        await db.commit()
    return user


# ── Part A: access ──────────────────────────────────────────────────────────


async def test_non_members_get_404_on_every_router(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    stranger = auth(await make_user("stranger@example.com"))
    t = cast.trip.id
    reads = [
        f"/trips/{t}", f"/trips/{t}/waypoints", f"/trips/{t}/itinerary", f"/trips/{t}/route",
        f"/trips/{t}/corridor/suggestions", f"/trips/{t}/radius/suggestions", f"/trips/{t}/export/gpx",
        f"/trips/{t}/export/ics", f"/trips/{t}/expenses", f"/trips/{t}/budget", f"/trips/{t}/packing",
        f"/trips/{t}/weather", f"/trips/{t}/navigation", f"/trips/{t}/recap", f"/trips/{t}/photos",
        f"/trips/{t}/members", f"/trips/{t}/changes", f"/trips/{t}/activity",
        f"/trips/{t}/comments?target_kind=trip", f"/trips/{t}/comments/counts", f"/trips/{t}/votes?kind=radius",
    ]  # fmt: skip
    for url in reads:
        r = await client.get(url, headers=stranger)
        assert r.status_code == 404, (url, r.status_code)
    writes = [
        ("POST", f"/trips/{t}/waypoints", {"address": "x", "lat": 1, "lng": 2}),
        ("PATCH", f"/trips/{t}", {"title": "hacked"}),
        ("DELETE", f"/trips/{t}", None),
        ("POST", f"/trips/{t}/share", None),
        ("POST", f"/trips/{t}/itinerary/days", {}),
        ("POST", f"/trips/{t}/calculate-route", None),
        ("POST", f"/trips/{t}/corridor/discover", None),
        ("POST", f"/trips/{t}/expenses", {"category": "food", "amount": 1}),
        ("POST", f"/trips/{t}/packing", {"label": "x"}),
        ("POST", f"/trips/{t}/invites", {"role": "viewer"}),
        ("POST", f"/trips/{t}/duplicate", None),
        ("POST", f"/trips/{t}/comments", {"target_kind": "trip", "body": "hi"}),
        ("PUT", f"/trips/{t}/votes", {"kind": "radius", "target_id": str(cast.radius_sg), "value": 1}),
    ]  # fmt: skip
    for method, url, body in writes:
        r = await client.request(method, url, json=body, headers=stranger)
        assert r.status_code == 404, (method, url, r.status_code)
    # And nothing changed.
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(Trip.title).where(Trip.id == t))).scalar_one() == "Group trip"


async def test_viewer_can_read_but_not_mutate(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    viewer = await add_member(cast, "viewer@example.com", "viewer")
    h, t = auth(viewer), cast.trip.id
    for url in (f"/trips/{t}", f"/trips/{t}/itinerary", f"/trips/{t}/expenses", f"/trips/{t}/budget",
                f"/trips/{t}/packing", f"/trips/{t}/recap", f"/trips/{t}/members", f"/trips/{t}/export/gpx"):  # fmt: skip
        assert (await client.get(url, headers=h)).status_code == 200, url
    me = (await client.get(f"/trips/{t}", headers=h)).json()
    assert me["my_role"] == "viewer" and me["owner_name"] == "owner" and me["member_count"] == 1

    forbidden = [
        ("POST", f"/trips/{t}/waypoints", {"address": "x", "lat": 1, "lng": 2}),
        ("PATCH", f"/trips/{t}", {"title": "nope"}),
        ("DELETE", f"/trips/{t}", None),
        ("POST", f"/trips/{t}/share", None),
        ("POST", f"/trips/{t}/itinerary/days", {}),
        ("POST", f"/trips/{t}/waypoints/{cast.wp}/check-in", {"action": "arrived"}),
        ("POST", f"/trips/{t}/expenses", {"category": "food", "amount": 1}),
        ("POST", f"/trips/{t}/packing", {"label": "x"}),
        ("POST", f"/trips/{t}/corridor/discover", None),
        ("POST", f"/trips/{t}/photos/upload-url", {"content_type": "image/webp", "bytes": 1, "width": 1, "height": 1}),
        ("POST", f"/trips/{t}/invites", {"role": "viewer"}),
    ]  # fmt: skip
    for method, url, body in forbidden:
        r = await client.request(method, url, json=body, headers=h)
        assert r.status_code in (403, 503), (method, url, r.status_code)  # 503: photos unconfigured
    # Voting and commenting are open to viewers.
    vote = await client.put(f"/trips/{t}/votes", json={"kind": "radius", "target_id": str(cast.radius_sg), "value": 1}, headers=h)
    assert vote.status_code == 200 and vote.json()["up"] == 1
    assert (await client.post(f"/trips/{t}/comments", json={"target_kind": "trip", "body": "Looks great"}, headers=h)).status_code == 201
    # A viewer can duplicate: the copy is theirs and independent.
    dup = await client.post(f"/trips/{t}/duplicate", headers=h)
    assert dup.status_code == 201 and dup.json()["my_role"] == "owner" and dup.json()["id"] != str(t)
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(Trip.user_id).where(Trip.id == dup.json()["id"]))).scalar_one() == viewer.id


async def test_editor_can_edit_but_not_manage(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    cast = await setup_trip(client)
    editor = await add_member(cast, "editor@example.com", "editor")
    h, t = auth(editor), cast.trip.id

    assert (await client.post(f"/trips/{t}/waypoints", json={"address": "x", "lat": 1, "lng": 2}, headers=h)).status_code == 201
    assert (await client.patch(f"/trips/{t}", json={"title": "Renamed"}, headers=h)).status_code == 200
    assert (await client.post(f"/trips/{t}/expenses", json={"category": "food", "amount": 5}, headers=h)).status_code == 201
    assert (await client.post(f"/trips/{t}/packing", json={"label": "Hat"}, headers=h)).status_code == 201

    assert (await client.delete(f"/trips/{t}", headers=h)).status_code == 403
    assert (await client.post(f"/trips/{t}/share", headers=h)).status_code == 403
    assert (await client.post(f"/trips/{t}/invites", json={"role": "viewer"}, headers=h)).status_code == 403
    assert (await client.patch(f"/trips/{t}", json={"share_recap": True}, headers=h)).status_code == 403
    assert (await client.delete(f"/trips/{t}/members/{cast.owner.id}", headers=h)).status_code == 403

    # Discovery by an editor spends the EDITOR's quota, not the owner's.
    monkeypatch.setattr(corridor_svc, "discover_corridor_suggestions", lambda **_: [])
    assert (await client.post(f"/trips/{t}/corridor/discover", headers=h)).status_code == 200
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            text("SELECT user_id, action, count FROM user_action_daily")
        )).all()
    assert [(r.user_id, r.action) for r in rows] == [(editor.id, "corridor_discover")]


# ── Part B: invites and members ─────────────────────────────────────────────


async def new_invite(client: httpx.AsyncClient, cast: Cast, role: str = "editor", **extra: Any) -> dict[str, Any]:
    r = await client.post(f"/trips/{cast.trip.id}/invites", json={"role": role, **extra}, headers=auth(cast.owner))
    assert r.status_code == 201, r.text
    return r.json()


def token_of(invite: dict[str, Any]) -> str:
    return invite["url"].rsplit("/", 1)[1]


async def test_invite_flow_accept_idempotent_never_demotes(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    invite = await new_invite(client, cast, "editor")
    token = token_of(invite)
    async with AsyncSessionLocal() as db:
        stored = (await db.execute(select(TripInvite.token_hash))).scalar_one()
    assert stored != token and len(stored) == 64  # only the hash is stored

    pre = (await client.get(f"/invites/{token}")).json()
    assert pre == {"valid": True, "trip_title": "Group trip", "owner_name": "owner", "role": "editor"}
    assert (await client.get("/invites/not-a-token")).json()["valid"] is False

    sam = await make_user("sam@example.com")
    first = await client.post(f"/invites/{token}/accept", headers=auth(sam))
    assert first.status_code == 200 and first.json() == {"trip_id": str(cast.trip.id), "role": "editor"}
    again = await client.post(f"/invites/{token}/accept", headers=auth(sam))
    assert again.json()["role"] == "editor"
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(TripInvite.uses))).scalar_one() == 1  # re-accept doesn't consume a use

    # A viewer invite never demotes an existing editor.
    viewer_token = token_of(await new_invite(client, cast, "viewer"))
    assert (await client.post(f"/invites/{viewer_token}/accept", headers=auth(sam))).json()["role"] == "editor"
    # The owner accepting their own invite is a harmless no-op.
    assert (await client.post(f"/invites/{token}/accept", headers=auth(cast.owner))).json()["role"] == "owner"

    members = (await client.get(f"/trips/{cast.trip.id}/members", headers=auth(sam))).json()
    assert [(m["name"], m["role"], m["is_you"]) for m in members] == [("owner", "owner", False), ("sam", "editor", True)]
    assert "email" not in members[0]
    # The shared trip appears in Sam's "shared" list, labelled with the owner and role.
    shared = (await client.get("/trips?scope=shared", headers=auth(sam))).json()["items"]
    assert [(i["title"], i["role"], i["owner_name"]) for i in shared] == [("Group trip", "editor", "owner")]
    mine = (await client.get("/trips?scope=mine", headers=auth(sam))).json()["items"]
    assert "Group trip" not in [i["title"] for i in mine]
    assert len((await client.get("/trips?scope=all", headers=auth(sam))).json()["items"]) == len(mine) + 1


async def test_invites_die_on_revoke_expiry_and_max_uses(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    h = auth(cast.owner)

    revoked = await new_invite(client, cast)
    assert (await client.delete(f"/trips/{cast.trip.id}/invites/{revoked['id']}", headers=h)).status_code == 204
    assert (await client.post(f"/invites/{token_of(revoked)}/accept", headers=auth(await make_user("a@example.com")))).status_code == 404
    assert (await client.get(f"/invites/{token_of(revoked)}")).json()["valid"] is False

    expired = await new_invite(client, cast)
    async with AsyncSessionLocal() as db:
        await db.execute(update(TripInvite).where(TripInvite.id == uuid.UUID(expired["id"])).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
        await db.commit()
    assert (await client.post(f"/invites/{token_of(expired)}/accept", headers=auth(await make_user("b@example.com")))).status_code == 404

    limited = await new_invite(client, cast)
    async with AsyncSessionLocal() as db:
        await db.execute(update(TripInvite).where(TripInvite.id == uuid.UUID(limited["id"])).values(max_uses=1))
        await db.commit()
    assert (await client.post(f"/invites/{token_of(limited)}/accept", headers=auth(await make_user("c@example.com")))).status_code == 200
    assert (await client.post(f"/invites/{token_of(limited)}/accept", headers=auth(await make_user("d@example.com")))).status_code == 404
    # Concurrent acceptances can't exceed max_uses either.
    race = await new_invite(client, cast)
    async with AsyncSessionLocal() as db:
        await db.execute(update(TripInvite).where(TripInvite.id == uuid.UUID(race["id"])).values(max_uses=2))
        await db.commit()
    users = [await make_user(f"r{i}@example.com") for i in range(5)]
    results = await asyncio.gather(*(client.post(f"/invites/{token_of(race)}/accept", headers=auth(u)) for u in users))
    assert sorted(r.status_code for r in results) == [200, 200, 404, 404, 404]
    # The owner can list live invites (no tokens in the response).
    listed = (await client.get(f"/trips/{cast.trip.id}/invites", headers=h)).json()
    assert all("url" not in i and "token" not in str(i) for i in listed)


async def test_invite_email_is_sent_via_console_without_resend(client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture) -> None:
    cast = await setup_trip(client)
    caplog.set_level(logging.WARNING)
    invite = await new_invite(client, cast, "viewer", email="friend@example.com")
    assert invite["emailed"] is True
    assert re.search(r"/invite/" + token_of(invite), caplog.text)


async def test_role_change_remove_and_leave(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    sam = await add_member(cast, "sam@example.com", "viewer")
    kim = await add_member(cast, "kim@example.com", "editor")
    oh, t = auth(cast.owner), cast.trip.id

    assert (await client.patch(f"/trips/{t}/members/{sam.id}", json={"role": "editor"}, headers=auth(kim))).status_code == 403
    changed = await client.patch(f"/trips/{t}/members/{sam.id}", json={"role": "editor"}, headers=oh)
    assert changed.status_code == 200 and changed.json()["role"] == "editor"
    assert (await client.post(f"/trips/{t}/waypoints", json={"address": "x", "lat": 1, "lng": 2}, headers=auth(sam))).status_code == 201

    assert (await client.delete(f"/trips/{t}/members/{cast.owner.id}", headers=oh)).status_code == 400
    assert (await client.delete(f"/trips/{t}/members/{kim.id}", headers=auth(sam))).status_code == 403
    assert (await client.delete(f"/trips/{t}/members/{sam.id}", headers=auth(sam))).status_code == 204  # leave
    assert (await client.get(f"/trips/{t}", headers=auth(sam))).status_code == 404
    assert (await client.delete(f"/trips/{t}/members/{kim.id}", headers=oh)).status_code == 204
    assert (await client.get(f"/trips/{t}", headers=auth(kim))).status_code == 404


# ── Part C: votes and comments ──────────────────────────────────────────────


async def test_votes_tally_clear_and_survive_rediscovery(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    cast = await setup_trip(client)
    sam = await add_member(cast, "sam@example.com", "editor")
    t = cast.trip.id

    async def vote(user: User, value: int, kind: str = "corridor", target: uuid.UUID | None = None) -> httpx.Response:
        return await client.put(f"/trips/{t}/votes", json={"kind": kind, "target_id": str(target or cast.corridor_sg), "value": value}, headers=auth(user))

    assert (await vote(cast.owner, 1)).json()["up"] == 1
    r = (await vote(sam, -1)).json()
    assert (r["up"], r["down"], r["mine"]) == (1, 1, -1) and {v["name"] for v in r["voters"]} == {"owner", "sam"}
    assert (await vote(sam, 1)).json()["up"] == 2  # changing a vote replaces it
    assert (await vote(sam, 0)).json()["up"] == 1  # 0 clears
    assert (await vote(cast.owner, 1, "radius", cast.radius_sg)).status_code == 200
    assert (await vote(cast.owner, 1, "corridor", uuid.uuid4())).status_code == 404  # not a suggestion of this trip
    assert (await vote(cast.owner, 1, "waypoint", cast.wp)).status_code == 200
    tallies = (await client.get(f"/trips/{t}/votes?kind=corridor", headers=auth(sam))).json()
    assert tallies[str(cast.corridor_sg)]["up"] == 1 and tallies[str(cast.corridor_sg)]["mine"] == 0

    # Re-running discovery replaces the rows; the vote follows the same place_id.
    place = {"place_id": "pid-c", "name": "Lake", "address": "a", "lat": 1.0, "lng": 1.0, "category": "park",
             "rating": 4.5, "user_ratings_total": 10, "quality_score": 1.0, "detour_seconds": 60, "route_fraction": 0.5}  # fmt: skip
    monkeypatch.setattr(corridor_svc, "discover_corridor_suggestions", lambda **_: [place])
    assert (await client.post(f"/trips/{t}/corridor/discover?refresh=true", headers=auth(cast.owner))).status_code == 200
    async with AsyncSessionLocal() as db:
        new_id = (await db.execute(select(CorridorSuggestion.id).where(CorridorSuggestion.trip_id == t))).scalar_one()
    assert new_id != cast.corridor_sg
    carried = (await client.get(f"/trips/{t}/votes?kind=corridor", headers=auth(cast.owner))).json()
    assert list(carried) == [str(new_id)] and carried[str(new_id)]["up"] == 1


async def test_comments_threads_counts_edit_and_soft_delete(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    sam = await add_member(cast, "sam@example.com", "viewer")
    kim = await add_member(cast, "kim@example.com", "editor")
    t = cast.trip.id
    nasty = "<script>alert(1)</script> & more"
    c1 = await client.post(f"/trips/{t}/comments", json={"target_kind": "waypoint", "target_id": str(cast.wp), "body": nasty}, headers=auth(sam))
    assert c1.status_code == 201 and c1.json()["body"] == nasty and c1.json()["author"] == "sam"  # plain text, stored verbatim
    c2 = await client.post(f"/trips/{t}/comments", json={"target_kind": "waypoint", "target_id": str(cast.wp), "body": "Agreed"}, headers=auth(kim))
    await client.post(f"/trips/{t}/comments", json={"target_kind": "day", "target_id": str(cast.day), "body": "Long day"}, headers=auth(kim))
    await client.post(f"/trips/{t}/comments", json={"target_kind": "trip", "body": "Can't wait"}, headers=auth(cast.owner))
    assert (await client.post(f"/trips/{t}/comments", json={"target_kind": "waypoint", "body": "x"}, headers=auth(sam))).status_code == 422
    assert (await client.post(f"/trips/{t}/comments", json={"target_kind": "day", "target_id": str(uuid.uuid4()), "body": "x"}, headers=auth(sam))).status_code == 404
    assert (await client.post(f"/trips/{t}/comments", json={"target_kind": "trip", "body": "x" * 1001}, headers=auth(sam))).status_code == 422

    counts = (await client.get(f"/trips/{t}/comments/counts", headers=auth(sam))).json()
    assert counts == {f"waypoint:{cast.wp}": 2, f"day:{cast.day}": 1, "trip:": 1}
    thread = (await client.get(f"/trips/{t}/comments?target_kind=waypoint&target_id={cast.wp}", headers=auth(sam))).json()
    assert [(c["author"], c["mine"]) for c in thread] == [("sam", True), ("kim", False)]

    assert (await client.patch(f"/trips/{t}/comments/{c2.json()['id']}", json={"body": "Hijack"}, headers=auth(sam))).status_code == 403
    edited = await client.patch(f"/trips/{t}/comments/{c1.json()['id']}", json={"body": "Edited"}, headers=auth(sam))
    assert edited.json()["body"] == "Edited" and edited.json()["edited_at"]
    assert (await client.delete(f"/trips/{t}/comments/{c2.json()['id']}", headers=auth(sam))).status_code == 403
    assert (await client.delete(f"/trips/{t}/comments/{c1.json()['id']}", headers=auth(sam))).status_code == 204
    assert (await client.delete(f"/trips/{t}/comments/{c2.json()['id']}", headers=auth(cast.owner))).status_code == 204  # owner moderates
    thread = (await client.get(f"/trips/{t}/comments?target_kind=waypoint&target_id={cast.wp}", headers=auth(kim))).json()
    assert [(c["deleted"], c["body"]) for c in thread] == [(True, ""), (True, "")]  # the thread keeps its shape
    assert (await client.get(f"/trips/{t}/comments/counts", headers=auth(kim))).json().get(f"waypoint:{cast.wp}") is None


# ── Part D: concurrency ─────────────────────────────────────────────────────


async def test_if_match_conflicts_and_no_lost_updates(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    editor = await add_member(cast, "kim@example.com", "editor")
    t, oh, kh = cast.trip.id, auth(cast.owner), auth(editor)

    v0 = (await client.get(f"/trips/{t}", headers=oh)).json()["version"]
    ok = await client.patch(f"/trips/{t}", json={"title": "Owner's title"}, headers={**oh, "If-Match": str(v0)})
    assert ok.status_code == 200 and ok.headers["x-trip-version"] == str(v0 + 1)
    assert ok.json()["version"] == v0 + 1

    # Kim still holds the old version: her save is refused with the current version, and
    # nothing of the owner's work is overwritten.
    stale = await client.patch(f"/trips/{t}", json={"title": "Kim's title"}, headers={**kh, "If-Match": str(v0)})
    assert stale.status_code == 409
    assert stale.json()["code"] == "version_conflict" and stale.json()["version"] == v0 + 1
    stale_wp = await client.post(f"/trips/{t}/waypoints", json={"address": "x", "lat": 1, "lng": 2}, headers={**kh, "If-Match": str(v0)})
    assert stale_wp.status_code == 409
    assert (await client.get(f"/trips/{t}", headers=kh)).json()["title"] == "Owner's title"
    fresh = await client.patch(f"/trips/{t}", json={"title": "Kim's title"}, headers={**kh, "If-Match": str(v0 + 1)})
    assert fresh.status_code == 200
    # No If-Match header: no check (older clients keep working).
    assert (await client.patch(f"/trips/{t}", json={"notes": "n"}, headers=oh)).status_code == 200
    # Reads never conflict, even with a stale header.
    assert (await client.get(f"/trips/{t}", headers={**kh, "If-Match": "1"})).status_code == 200

    # Two writers racing on the same version: exactly one wins.
    cur = (await client.get(f"/trips/{t}", headers=oh)).json()["version"]
    a, b = await asyncio.gather(
        client.patch(f"/trips/{t}", json={"title": "A"}, headers={**oh, "If-Match": str(cur)}),
        client.patch(f"/trips/{t}", json={"title": "B"}, headers={**kh, "If-Match": str(cur)}),
    )
    assert sorted([a.status_code, b.status_code]) == [200, 409]


async def test_changes_poll_and_activity_feed(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    editor = await add_member(cast, "kim@example.com", "editor")
    t, oh, kh = cast.trip.id, auth(cast.owner), auth(editor)

    v = (await client.get(f"/trips/{t}/changes", headers=oh)).json()["version"]
    quiet = (await client.get(f"/trips/{t}/changes?since_version={v}", headers=oh)).json()
    assert quiet == {"version": v, "changed": False, "activity": []}

    await client.post(f"/trips/{t}/waypoints", json={"address": "9 St", "lat": 1, "lng": 2, "label": "Arches National Park"}, headers=kh)
    seen = (await client.get(f"/trips/{t}/changes?since_version={v}", headers=oh)).json()
    assert seen["changed"] is True and seen["version"] == v + 1
    assert seen["activity"][0]["summary"] == "kim added Arches National Park to the trip"
    feed = (await client.get(f"/trips/{t}/activity", headers=oh)).json()
    assert feed[0]["kind"] == "waypoint_added" and len(feed) <= 20


# ── Part E: notifications ───────────────────────────────────────────────────


async def test_notifications_count_other_peoples_activity_until_seen(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    editor = await add_member(cast, "kim@example.com", "editor")
    t, oh = cast.trip.id, auth(cast.owner)
    async with AsyncSessionLocal() as db:  # the owner's account is older than the activity below
        await db.execute(update(User).where(User.id == cast.owner.id).values(created_at=datetime.now(UTC) - timedelta(days=1)))
        await db.commit()
    assert (await client.get("/notifications", headers=oh)).json()["unread"] == 0
    await client.post(f"/trips/{t}/waypoints", json={"address": "x", "lat": 1, "lng": 2}, headers=auth(editor))
    await client.post(f"/trips/{t}/comments", json={"target_kind": "trip", "body": "hello"}, headers=auth(editor))
    await client.post(f"/trips/{t}/comments", json={"target_kind": "trip", "body": "my own"}, headers=oh)
    note = (await client.get("/notifications", headers=oh)).json()
    assert note["unread"] == 2 and note["items"][0]["trip_title"] == "Group trip"  # own activity isn't counted
    assert (await client.post("/notifications/seen", headers=oh)).status_code == 204
    assert (await client.get("/notifications", headers=oh)).json()["unread"] == 0
    await client.post(f"/trips/{t}/comments", json={"target_kind": "trip", "body": "again"}, headers=auth(editor))
    assert (await client.get("/notifications", headers=oh)).json()["unread"] == 1


async def test_public_share_stays_read_only_and_never_lists_members(client: httpx.AsyncClient) -> None:
    cast = await setup_trip(client)
    await add_member(cast, "kim@example.com", "editor")
    token = (await client.post(f"/trips/{cast.trip.id}/share", headers=auth(cast.owner))).json()["share_token"]
    body = (await client.get(f"/shared/{token}")).text
    assert "kim" not in body and "members" not in body
