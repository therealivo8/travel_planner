import * as React from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  heading: string;
  subtext?: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon, heading, subtext, cta, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-8", className)}>
      {icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-100 text-3xl">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-neutral-900 mb-1">{heading}</h3>
      {subtext && <p className="text-sm text-neutral-500 max-w-sm mb-6">{subtext}</p>}
      {cta && (
        <Button onClick={cta.onClick}>{cta.label}</Button>
      )}
    </div>
  );
}
