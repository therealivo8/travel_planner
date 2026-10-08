"use client";

import { MoonStar } from "lucide-react";
import { useUnits } from "@/hooks/useUnits";
import { FORECAST_WINDOW_DAYS, daysUntil, formatTemp, weatherIcon } from "@/lib/logistics";
import type { DayWeather } from "@/types";

interface WeatherChipProps {
  date: string | null;
  weather: DayWeather | undefined;
}

/**
 * Forecast chip for a day column header. Renders nothing when the day has no date, is in
 * the past, or the forecast service is down — weather must never break the board.
 */
export function WeatherChip({ date, weather }: WeatherChipProps) {
  const units = useUnits();
  const until = daysUntil(date);
  if (until === null || until < 0) return null;

  if (!weather) {
    if (until < FORECAST_WINDOW_DAYS) return null; // in range but unavailable: hide
    const wait = until - (FORECAST_WINDOW_DAYS - 1);
    return (
      <p className="text-[11px] text-neutral-400">
        Forecast available {wait} day{wait === 1 ? "" : "s"} before
      </p>
    );
  }

  const { Icon, label } = weatherIcon(weather.code);
  return (
    <div className="flex flex-col gap-1">
      <p
        className="flex items-center gap-1.5 text-xs text-neutral-600"
        title={`${label}${weather.precip_pct != null ? ` · ${weather.precip_pct}% chance of precipitation` : ""}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {formatTemp(weather.hi, units)} / {formatTemp(weather.lo, units)}
        </span>
        {weather.precip_pct != null && weather.precip_pct >= 20 && (
          <span className="text-neutral-400">{weather.precip_pct}%</span>
        )}
      </p>
      {weather.after_dark && (
        <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
          <MoonStar className="h-3 w-3 shrink-0" aria-hidden />
          You&apos;ll arrive after dark
        </p>
      )}
    </div>
  );
}
