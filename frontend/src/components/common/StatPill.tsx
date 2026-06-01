import * as React from "react";
import { cn } from "@/lib/utils";

interface StatPillProps {
  icon: React.ReactNode;
  value: string;
  unit?: string;
  className?: string;
}

export function StatPill({ icon, value, unit, className }: StatPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-neutral-500 font-mono",
        className
      )}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="font-medium text-neutral-900">{value}</span>
      {unit && <span className="text-neutral-500">{unit}</span>}
    </span>
  );
}
