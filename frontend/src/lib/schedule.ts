import type { ItineraryWaypoint } from "@/types";

/** Minutes since local midnight, for an ISO instant viewed in an IANA timezone. */
export function localMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** "HH:MM[:SS]" → minutes since midnight. */
export function clockMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Today's date (YYYY-MM-DD) in a timezone — how the Today view picks the current day. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface ScheduleStatus {
  /** Positive = ahead of schedule, negative = behind. */
  deltaMinutes: number;
}

/**
 * Ahead/behind schedule from check-ins and the stored leg drive times — no API call.
 * Projects when the user will reach the next stop (last check-in + time spent there + the
 * stored drive to it) and compares that to the next stop's scheduled arrival. With no next
 * stop or no stored leg, falls back to how early/late the last check-in itself was.
 */
export function scheduleStatus(stops: ItineraryWaypoint[], timeZone: string): ScheduleStatus | null {
  let lastIdx = -1;
  stops.forEach((s, i) => {
    if (s.visited_at) lastIdx = i;
  });
  if (lastIdx < 0) return null;
  const last = stops[lastIdx];
  const arrivedAt = localMinutes(last.visited_at as string, timeZone);

  const next = stops.slice(lastIdx + 1).find((s) => !s.visited_at && !s.skipped);
  if (next?.scheduled_arrival_time && next.drive_seconds_from_prev != null) {
    const eta = arrivedAt + (last.stop_duration_minutes ?? 0) + Math.round(next.drive_seconds_from_prev / 60);
    return { deltaMinutes: clockMinutes(next.scheduled_arrival_time) - eta };
  }
  if (last.scheduled_arrival_time) {
    return { deltaMinutes: clockMinutes(last.scheduled_arrival_time) - arrivedAt };
  }
  return null;
}

export function describeDelta(deltaMinutes: number): string {
  const m = Math.abs(deltaMinutes);
  if (m < 5) return "On schedule";
  const h = Math.floor(m / 60);
  const text = h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
  return deltaMinutes > 0 ? `${text} ahead` : `${text} behind`;
}
