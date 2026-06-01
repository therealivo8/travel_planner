import * as React from "react";
import { MoreVertical } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { StatPill } from "@/components/common";
import { cn } from "@/lib/utils";
import type { TripMode, TripStatus } from "@/types";

interface TripCardProps {
  title: string;
  mode: TripMode;
  status: TripStatus;
  coverImage?: string;
  distanceMi?: number;
  driveTimeMin?: number;
  stopCount?: number;
  updatedAt?: Date;
  onMenuClick?: () => void;
  className?: string;
}

const modeLabel: Record<TripMode, string> = {
  "point-to-point": "Point-to-Point",
  radius: "Radius",
};

const statusVariant: Record<TripStatus, "default" | "outline" | "success" | "warning" | "draft"> = {
  draft: "draft",
  planned: "default",
  completed: "success",
};

const statusLabel: Record<TripStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  completed: "Completed",
};

function CoverGradient() {
  return (
    <div className="w-full h-full bg-gradient-to-br from-primary-500 via-primary-600 to-accent-500 opacity-80" />
  );
}

export function TripCard({
  title,
  mode,
  status,
  coverImage,
  distanceMi,
  driveTimeMin,
  stopCount,
  updatedAt,
  onMenuClick,
  className,
}: TripCardProps) {
  const hours = driveTimeMin !== undefined ? Math.floor(driveTimeMin / 60) : undefined;
  const minutes = driveTimeMin !== undefined ? driveTimeMin % 60 : undefined;

  return (
    <div
      className={cn(
        "group rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow",
        className
      )}
    >
      {/* Cover image */}
      <div className="relative h-36 overflow-hidden bg-neutral-200">
        {coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverImage} alt={title} className="w-full h-full object-cover" />
        ) : (
          <CoverGradient />
        )}
        {/* Badges overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <Badge variant="outline" className="bg-white/90 backdrop-blur-sm text-xs">
            {modeLabel[mode]}
          </Badge>
        </div>
        {/* 3-dot menu */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/90 backdrop-blur-sm hover:bg-white"
            onClick={onMenuClick}
            aria-label="Trip options"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-semibold text-neutral-900 text-sm leading-snug line-clamp-2">{title}</h3>
          <Badge variant={statusVariant[status]} className="shrink-0 text-xs">
            {statusLabel[status]}
          </Badge>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 flex-wrap mb-3">
          {driveTimeMin !== undefined && (
            <StatPill icon="🕐" value={`${hours}h ${minutes}min`} />
          )}
          {distanceMi !== undefined && (
            <StatPill icon="📍" value={distanceMi.toString()} unit="mi" />
          )}
          {stopCount !== undefined && (
            <StatPill icon="🚏" value={stopCount.toString()} unit="stops" />
          )}
        </div>

        {updatedAt && (
          <p className="text-xs text-neutral-500">
            Updated {updatedAt.toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}
