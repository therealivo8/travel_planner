import * as React from "react";
import { cn } from "@/lib/utils";

interface LoadingOverlayProps {
  message?: string;
  className?: string;
}

export function LoadingOverlay({ message, className }: LoadingOverlayProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-16", className)}>
      <div className="h-10 w-10 rounded-full border-4 border-neutral-200 border-t-primary-500 animate-spin" />
      {message && <p className="text-sm text-neutral-500 animate-pulse">{message}</p>}
    </div>
  );
}
