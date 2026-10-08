import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Snowflake,
  Sun,
  type LucideIcon,
} from "lucide-react";

export const cToF = (c: number) => (c * 9) / 5 + 32;

/** The API reports Celsius; show it in the user's unit system (°F for imperial). */
export const formatTemp = (c: number | null, units: "imperial" | "metric" = "imperial") =>
  c == null ? "–" : `${Math.round(units === "metric" ? c : cToF(c))}°`;

export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** WMO weather interpretation codes → icon and a short label. */
export function weatherIcon(code: number | null): { Icon: LucideIcon; label: string } {
  if (code == null) return { Icon: Cloud, label: "Unknown" };
  if (code === 0 || code === 1) return { Icon: Sun, label: "Clear" };
  if (code === 2 || code === 3) return { Icon: Cloud, label: "Cloudy" };
  if (code === 45 || code === 48) return { Icon: CloudFog, label: "Fog" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, label: "Drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))
    return { Icon: CloudRain, label: "Rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { Icon: code === 77 ? Snowflake : CloudSnow, label: "Snow" };
  if (code >= 95) return { Icon: CloudLightning, label: "Thunderstorm" };
  return { Icon: Cloud, label: "Cloudy" };
}

/** Open-Meteo's forecast covers today plus 15 days. */
export const FORECAST_WINDOW_DAYS = 16;

/** Whole days from today (local) until an ISO date, or null when there's no date. */
export function daysUntil(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}
