import { Clock, Milestone } from "lucide-react";
import { formatDistance, formatDuration } from "@/lib/format";
import { useUnits } from "@/hooks/useUnits";

interface Props {
  totalDistanceMeters: number | null;
  totalDriveSeconds: number | null;
}

export function RouteStats({ totalDistanceMeters, totalDriveSeconds }: Props) {
  const units = useUnits();
  if (!totalDistanceMeters && !totalDriveSeconds) return null;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {totalDistanceMeters != null && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
          <Milestone className="h-4 w-4 text-primary-500" />
          <span>{formatDistance(totalDistanceMeters, units)}</span>
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
