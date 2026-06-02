import { Clock, Milestone } from "lucide-react";

interface Props {
  totalDistanceMeters: number | null;
  totalDriveSeconds: number | null;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return miles >= 10
    ? `${Math.round(miles)} mi`
    : `${miles.toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function RouteStats({ totalDistanceMeters, totalDriveSeconds }: Props) {
  if (!totalDistanceMeters && !totalDriveSeconds) return null;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {totalDistanceMeters != null && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <Milestone className="h-4 w-4 text-primary-500" />
          <span>{formatDistance(totalDistanceMeters)}</span>
        </div>
      )}
      {totalDriveSeconds != null && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <Clock className="h-4 w-4 text-primary-500" />
          <span>{formatDuration(totalDriveSeconds)}</span>
        </div>
      )}
    </div>
  );
}
