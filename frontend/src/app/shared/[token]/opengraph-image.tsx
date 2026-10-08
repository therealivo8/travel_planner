import { ImageResponse } from "next/og";
import { formatDistance } from "@/lib/format";
import { routeToPath } from "@/lib/polyline";
import type { PublicTrip } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const alt = "Road trip route";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Link-preview image for shared trips: the route drawn from the stored polyline plus title
 * and stats. Rendered on demand and cached at the edge — no Google Static Maps call.
 */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let trip: PublicTrip | null = null;
  try {
    const res = await fetch(`${API_URL}/shared/${token}`, { cache: "no-store" });
    if (res.ok) trip = (await res.json()) as PublicTrip;
  } catch {
    // fall through to the generic card
  }

  const route = trip?.route_polyline ? routeToPath(trip.route_polyline, 640, 520, 40) : null;
  const days = trip?.days?.length ?? 0;
  const stats = trip
    ? [
        trip.total_distance_meters ? formatDistance(trip.total_distance_meters, trip.units) : null,
        days > 0 ? `${days} day${days === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#EFF6FF",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 560,
            padding: 64,
          }}
        >
          <div style={{ display: "flex", fontSize: 28, color: "#3B82F6", fontWeight: 700 }}>
            Road Trip Planner
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: "#111827", lineHeight: 1.1 }}>
              {trip?.title ?? "Shared trip"}
            </div>
            {stats && (
              <div style={{ display: "flex", fontSize: 36, color: "#4B5563", marginTop: 24 }}>
                {stats}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
          {route ? (
            <svg width="640" height="520" viewBox="0 0 640 520">
              <path
                d={route.d}
                fill="none"
                stroke="#3B82F6"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={route.start[0]} cy={route.start[1]} r="16" fill="#16A34A" stroke="white" strokeWidth="5" />
              <circle cx={route.end[0]} cy={route.end[1]} r="16" fill="#DC2626" stroke="white" strokeWidth="5" />
            </svg>
          ) : null}
        </div>
      </div>
    ),
    { ...size }
  );
}
