import { routeToPath } from "@/lib/polyline";
import { cn } from "@/lib/utils";

const W = 320;
const H = 180;

/**
 * A trip's route drawn as an inline SVG path from its stored polyline: no network request,
 * no Static Maps call. Decoding happens at render, which is cheap for the simplified
 * polylines the list endpoint sends.
 */
export function RouteThumb({ polyline, className }: { polyline: string; className?: string }) {
  const route = routeToPath(polyline, W, H, 20);
  if (!route) return null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Route preview"
      preserveAspectRatio="xMidYMid meet"
      className={cn("h-full w-full bg-primary-50", className)}
    >
      <path
        d={route.d}
        fill="none"
        stroke="var(--color-primary, #3B82F6)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={route.start[0]} cy={route.start[1]} r={6} fill="#16A34A" stroke="white" strokeWidth={2} />
      <circle cx={route.end[0]} cy={route.end[1]} r={6} fill="#DC2626" stroke="white" strokeWidth={2} />
    </svg>
  );
}
