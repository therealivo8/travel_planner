import * as React from "react";
import { TopNav } from "./TopNav";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
  fullWidth?: boolean;
  /** Skip the max-w/padding content wrapper entirely — for pages with their own
   * edge-to-edge, viewport-height layout (maps, kanban boards). */
  fullBleed?: boolean;
  className?: string;
}

/** Height of TopNav's `h-16` bar — used by full-bleed pages to size content to
 * exactly fill the remaining viewport below it. */
export const TOP_NAV_HEIGHT = "4rem";

export function PageShell({
  children,
  title,
  actions,
  fullWidth = false,
  fullBleed = false,
  className,
}: PageShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <TopNav />
      {(title || actions) && (
        <div className="border-b border-neutral-200 bg-white">
          <div className={cn("mx-auto px-4 sm:px-6 lg:px-8 py-4", fullWidth ? "w-full" : "max-w-7xl")}>
            <div className="flex items-center justify-between gap-4">
              {title && (
                <h1 className="text-2xl font-bold text-neutral-900">{title}</h1>
              )}
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          </div>
        </div>
      )}
      <main className={cn("flex-1 flex flex-col", className)}>
        {fullBleed ? (
          children
        ) : (
          <div className={cn("mx-auto px-4 sm:px-6 lg:px-8 py-8", fullWidth ? "w-full" : "max-w-7xl")}>
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
