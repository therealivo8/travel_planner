import { Navigation } from "lucide-react";
import type { DayNavigation } from "@/types";

/**
 * "Open in Maps" handoff. Google Maps links carry the whole day (split into parts when it
 * has too many stops for one link); Apple Maps can only route one leg at a time.
 */
export function NavButtons({ nav, className }: { nav: DayNavigation | undefined; className?: string }) {
  if (!nav || nav.google.length === 0) return null;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        {nav.google.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-50"
          >
            <Navigation className="h-3 w-3" aria-hidden />
            {link.label}
          </a>
        ))}
      </div>
      {nav.apple.length > 0 && (
        <details className="mt-1 text-[11px] text-neutral-500">
          <summary className="cursor-pointer select-none">Apple Maps (one link per stop)</summary>
          <ol className="mt-1 flex flex-col gap-0.5 pl-4 list-decimal">
            {nav.apple.map((link) => (
              <li key={link.url} className="truncate">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-700 hover:underline"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
