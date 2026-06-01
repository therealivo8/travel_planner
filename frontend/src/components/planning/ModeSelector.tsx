"use client";

import * as React from "react";
import { ArrowRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TripMode } from "@/types";

interface ModeSelectorProps {
  value: TripMode | null;
  onChange: (mode: TripMode) => void;
  className?: string;
}

const modes: {
  id: TripMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "point-to-point",
    label: "Point-to-Point",
    description: "Plan a route from start to finish",
    icon: (
      <div className="flex items-center gap-1">
        <div className="h-2 w-2 rounded-full bg-current" />
        <div className="h-0.5 w-6 bg-current" />
        <ArrowRight className="h-3 w-3" />
        <div className="h-2 w-2 rounded-full bg-current" />
      </div>
    ),
  },
  {
    id: "radius",
    label: "Radius Explorer",
    description: "Explore destinations within a drive time",
    icon: (
      <div className="relative flex h-6 w-6 items-center justify-center">
        <Circle className="h-6 w-6 opacity-30" />
        <div className="absolute h-1.5 w-1.5 rounded-full bg-current" />
      </div>
    ),
  },
];

export function ModeSelector({ value, onChange, className }: ModeSelectorProps) {
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-3", className)}>
      {modes.map((mode) => {
        const selected = value === mode.id;
        return (
          <button
            key={mode.id}
            onClick={() => onChange(mode.id)}
            className={cn(
              "flex items-start gap-4 p-5 rounded-xl border-2 text-left transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
              selected
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
            )}
            aria-pressed={selected}
          >
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm",
                selected ? "bg-primary-100 text-primary-600" : "bg-neutral-100 text-neutral-500"
              )}
            >
              {mode.icon}
            </div>
            <div>
              <p className={cn("font-semibold text-sm", selected ? "text-primary-700" : "text-neutral-900")}>
                {mode.label}
              </p>
              <p className={cn("text-xs mt-0.5", selected ? "text-primary-600" : "text-neutral-500")}>
                {mode.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
