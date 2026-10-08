export type Units = "imperial" | "metric";

const METERS_PER_MILE = 1609.34;

/** Distance split into a number and its unit, for stat pills. */
export function distanceParts(meters: number, units: Units = "imperial") {
  const value = units === "metric" ? meters / 1000 : meters / METERS_PER_MILE;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return { value: rounded, unit: units === "metric" ? "km" : "mi" };
}

/** "412 mi" / "6.4 km". The one place distances become text. */
export function formatDistance(meters: number | null, units: Units = "imperial"): string {
  if (meters == null) return "—";
  const { value, unit } = distanceParts(meters, units);
  return `${value} ${unit}`;
}

/** "2 h 5 min". */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Distance and time of one leg, e.g. "41 mi · 45 min". */
export function formatLeg(
  seconds: number | null,
  meters: number | null,
  units: Units = "imperial"
): string | null {
  if (seconds == null && meters == null) return null;
  const parts: string[] = [];
  if (meters != null) parts.push(formatDistance(meters, units));
  if (seconds != null) parts.push(formatDuration(seconds));
  return parts.join(" · ");
}
