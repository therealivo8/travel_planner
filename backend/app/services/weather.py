"""Open-Meteo daily forecast (Phase 16, Part B). Free for non-commercial use, no API key.

Data by Open-Meteo.com (CC BY 4.0) — attribution is shown in the UI footer.
"""

from datetime import date, datetime, time
from typing import Any

import httpx

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_DAYS = 16
DAILY = (
    "temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
    "weather_code,sunrise,sunset"
)

# WMO weather codes that mean precipitation.
RAIN_CODES = frozenset({*range(51, 68), *range(80, 83), *range(95, 100)})
SNOW_CODES = frozenset({*range(71, 78), 85, 86})


def fetch_day(lat: float, lng: float, day: date) -> dict[str, Any]:
    """Forecast for one location and date, in Celsius. Raises on any failure."""
    resp = httpx.get(
        FORECAST_URL,
        params={
            "latitude": f"{lat:.2f}",
            "longitude": f"{lng:.2f}",
            "daily": DAILY,
            "timezone": "auto",
            "start_date": day.isoformat(),
            "end_date": day.isoformat(),
        },
        timeout=10,
    )
    resp.raise_for_status()
    daily = resp.json()["daily"]
    return {
        "hi": daily["temperature_2m_max"][0],
        "lo": daily["temperature_2m_min"][0],
        "precip_pct": daily["precipitation_probability_max"][0],
        "code": daily["weather_code"][0],
        "sunrise": daily["sunrise"][0],  # local time, e.g. "2026-10-10T07:12"
        "sunset": daily["sunset"][0],
    }


def arrives_after_dark(
    last_arrival: time | None, stop_minutes: int | None, sunset_iso: str | None
) -> bool:
    """Whether the day's last scheduled stop finishes after sunset (both in local time)."""
    if last_arrival is None or not sunset_iso:
        return False
    sunset = datetime.fromisoformat(sunset_iso).time()
    end_minutes = last_arrival.hour * 60 + last_arrival.minute + (stop_minutes or 0)
    return end_minutes > sunset.hour * 60 + sunset.minute


def is_wet(payload: dict[str, Any]) -> bool:
    pct = payload.get("precip_pct")
    return (pct is not None and pct >= 50) or payload.get("code") in RAIN_CODES | SNOW_CODES
