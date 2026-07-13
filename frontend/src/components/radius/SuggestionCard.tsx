"use client";

import { Utensils, Trees, Landmark, Building2, HelpCircle, Star, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SuggestionCategory } from "@/types";

const CATEGORY_META: Record<
  SuggestionCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  park: { label: "Park", icon: Trees, color: "text-green-600" },
  restaurant: { label: "Food", icon: Utensils, color: "text-orange-500" },
  landmark: { label: "Landmark", icon: Landmark, color: "text-blue-600" },
  town: { label: "Town", icon: Building2, color: "text-purple-600" },
  other: { label: "Other", icon: HelpCircle, color: "text-neutral-400" },
};

export function formatDriveTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

interface CardSuggestion {
  id: string;
  name: string;
  address: string;
  category: SuggestionCategory;
  rating: number | null;
  selected: boolean;
}

interface Props {
  suggestion: CardSuggestion;
  /** Seconds value to show in the clock badge, e.g. drive time from start, or detour time. */
  metaSeconds: number;
  /** Optional prefix for the clock badge, e.g. "+" for a detour. Defaults to "". */
  metaPrefix?: string;
  onToggle: (id: string) => void;
}

export function SuggestionCard({ suggestion, metaSeconds, metaPrefix = "", onToggle }: Props) {
  const meta = CATEGORY_META[suggestion.category] ?? CATEGORY_META.other;
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={() => onToggle(suggestion.id)}
      className={cn(
        "w-full text-left rounded-xl border-2 p-3 transition-colors",
        suggestion.selected
          ? "border-primary-500 bg-primary-50"
          : "border-neutral-200 hover:border-neutral-300 bg-white"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Category icon */}
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            suggestion.selected ? "bg-primary-100" : "bg-neutral-100"
          )}
        >
          <Icon className={cn("h-4 w-4", suggestion.selected ? "text-primary-600" : meta.color)} />
        </div>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-900">{suggestion.name}</p>
          <p className="truncate text-xs text-neutral-500">{suggestion.address}</p>

          {/* Badges */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
              <Clock className="h-3 w-3" />
              {metaPrefix}
              {formatDriveTime(metaSeconds)}
            </span>
            {suggestion.rating != null && (
              <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {suggestion.rating.toFixed(1)}
              </span>
            )}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                suggestion.selected
                  ? "bg-primary-100 text-primary-700"
                  : "bg-neutral-100 text-neutral-600"
              )}
            >
              {meta.label}
            </span>
          </div>
        </div>

        {/* Selected checkmark */}
        {suggestion.selected && (
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500">
            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>
    </button>
  );
}
