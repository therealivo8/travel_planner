import html
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.models.trip import ItineraryDay, Trip

router = APIRouter(tags=["export"])

DB = Annotated[AsyncSession, Depends(get_db)]


def _e(value: object) -> str:
    """Escape a value for safe interpolation into the export HTML."""
    return html.escape(str(value or ""))


def _format_duration(seconds: int | None) -> str:
    if seconds is None:
        return "—"
    hours, remainder = divmod(int(seconds), 3600)
    minutes = remainder // 60
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def _format_distance(meters: int | None) -> str:
    if meters is None:
        return "—"
    miles = meters / 1609.34
    return f"{miles:.1f} mi"


def _build_html(trip: Trip) -> str:
    sorted_wps = sorted(trip.waypoints, key=lambda w: w.position)
    sorted_days = sorted(trip.itinerary_days, key=lambda d: d.day_number)

    unscheduled = [w for w in sorted_wps if w.itinerary_day_id is None]
    day_wp_map: dict[uuid.UUID, list] = {d.id: [] for d in sorted_days}
    for wp in sorted_wps:
        if wp.itinerary_day_id and wp.itinerary_day_id in day_wp_map:
            day_wp_map[wp.itinerary_day_id].append(wp)

    # Build day sections
    day_sections = ""
    for day in sorted_days:
        day_wps = sorted(day_wp_map[day.id], key=lambda w: w.position)
        date_str = day.date.strftime("%B %d, %Y") if day.date else f"Day {day.day_number}"
        title_str = _e(day.title) or f"Day {day.day_number}"

        wp_rows = ""
        for wp in day_wps:
            arrival = wp.scheduled_arrival_time.strftime("%I:%M %p") if wp.scheduled_arrival_time else "—"
            leg_time = _format_duration(wp.drive_seconds_from_prev)
            wp_rows += f"""
            <tr>
              <td class="wp-name">{_e(wp.label or wp.address)}</td>
              <td class="wp-arrival">{arrival}</td>
              <td class="wp-drive">+{leg_time}</td>
            </tr>"""

        if not wp_rows:
            wp_rows = '<tr><td colspan="3" class="empty">No stops assigned</td></tr>'

        day_sections += f"""
        <div class="day-section">
          <div class="day-header">
            <span class="day-num">Day {day.day_number}</span>
            <span class="day-title">{title_str}</span>
            <span class="day-date">{date_str}</span>
          </div>
          {f'<p class="day-notes">{_e(day.notes)}</p>' if day.notes else ""}
          <table class="wp-table">
            <thead>
              <tr><th>Stop</th><th>Arrival</th><th>Drive from prev</th></tr>
            </thead>
            <tbody>{wp_rows}</tbody>
          </table>
        </div>"""

    # Unscheduled section
    unscheduled_section = ""
    if unscheduled:
        rows = "".join(
            f'<li>{_e(wp.label or wp.address)}</li>' for wp in unscheduled
        )
        unscheduled_section = f"""
        <div class="day-section">
          <div class="day-header"><span class="day-title">Unscheduled Stops</span></div>
          <ul class="unscheduled-list">{rows}</ul>
        </div>"""

    start_date_str = trip.start_date.strftime("%B %d, %Y") if trip.start_date else "Date TBD"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body {{ font-family: Georgia, serif; margin: 0; padding: 40px; color: #1a1a1a; }}
  h1 {{ font-size: 2em; margin-bottom: 4px; }}
  .meta {{ color: #555; font-size: 0.9em; margin-bottom: 8px; }}
  .stats {{ display: flex; gap: 32px; margin: 16px 0 32px; padding: 16px; background: #f5f5f5; border-radius: 8px; }}
  .stat-item {{ display: flex; flex-direction: column; }}
  .stat-label {{ font-size: 0.75em; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }}
  .stat-value {{ font-size: 1.1em; font-weight: bold; }}
  .day-section {{ margin-bottom: 32px; page-break-inside: avoid; }}
  .day-header {{ display: flex; align-items: baseline; gap: 12px; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 12px; }}
  .day-num {{ font-size: 0.8em; font-weight: bold; color: #888; text-transform: uppercase; }}
  .day-title {{ font-size: 1.1em; font-weight: bold; }}
  .day-date {{ font-size: 0.85em; color: #666; margin-left: auto; }}
  .day-notes {{ font-size: 0.85em; color: #555; font-style: italic; margin: 0 0 10px; }}
  .wp-table {{ width: 100%; border-collapse: collapse; font-size: 0.9em; }}
  .wp-table th {{ text-align: left; padding: 6px 8px; background: #f0f0f0; border-bottom: 1px solid #ccc; font-size: 0.8em; text-transform: uppercase; color: #666; }}
  .wp-table td {{ padding: 8px; border-bottom: 1px solid #eee; }}
  .wp-name {{ width: 60%; }}
  .wp-arrival, .wp-drive {{ width: 20%; }}
  .empty {{ color: #aaa; font-style: italic; padding: 12px 8px; }}
  .unscheduled-list {{ margin: 0; padding-left: 20px; color: #555; font-size: 0.9em; }}
  .route-info {{ margin-bottom: 24px; font-size: 0.9em; color: #444; }}
</style>
</head>
<body>
  <h1>{_e(trip.title)}</h1>
  <p class="meta">{start_date_str} &bull; {trip.mode.replace("_", " ").title()} trip</p>
  <p class="route-info">
    <strong>From:</strong> {_e(trip.start_address)}
    {f"<br><strong>To:</strong> {_e(trip.end_address)}" if trip.end_address else ""}
  </p>
  <div class="stats">
    <div class="stat-item">
      <span class="stat-label">Total Distance</span>
      <span class="stat-value">{_format_distance(trip.total_distance_meters)}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Drive Time</span>
      <span class="stat-value">{_format_duration(trip.total_drive_seconds)}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Days Planned</span>
      <span class="stat-value">{len(sorted_days)}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Stops</span>
      <span class="stat-value">{len(sorted_wps)}</span>
    </div>
  </div>

  {day_sections}
  {unscheduled_section}
</body>
</html>"""


@router.get("/trips/{trip_id}/export/pdf")
async def export_pdf(
    trip_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> Response:
    try:
        import weasyprint  # type: ignore[import-untyped]
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="PDF export requires WeasyPrint. Install it with: pip install weasyprint",
        )

    result = await db.execute(
        select(Trip)
        .where(Trip.id == trip_id, Trip.user_id == current_user.id)
        .options(
            selectinload(Trip.waypoints),
            selectinload(Trip.itinerary_days).selectinload(ItineraryDay.waypoints),
        )
    )
    trip = result.scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    document_html = _build_html(trip)
    # Defense in depth alongside _e(): even if an unescaped field slips through in the
    # future, WeasyPrint can't be made to fetch an attacker-controlled URL (SSRF) — only
    # inline data: URIs resolve, everything else fails to load instead of erroring out.
    url_fetcher = weasyprint.URLFetcher(allowed_protocols=["data"])
    pdf_bytes = weasyprint.HTML(string=document_html, url_fetcher=url_fetcher).write_pdf()

    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in trip.title)[:60]
    filename = f"{safe_title}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
