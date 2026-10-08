import { CalendarDays, Camera, Clock, MapPin, Ruler, Wallet } from "lucide-react";
import { PhotoGrid } from "@/components/memories/PhotoGrid";
import { formatDistance, formatDuration, type Units } from "@/lib/format";
import { formatMoney } from "@/lib/logistics";
import type { Recap } from "@/types";

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 text-center">
      <Icon className="mx-auto mb-1 h-4 w-4 text-neutral-400" aria-hidden />
      <p className="text-lg font-bold text-neutral-900">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}

/** Trip recap: stats and a day-by-day timeline. Shared by the owner page and the share page. */
export function RecapView({ recap, units }: { recap: Recap; units: Units }) {
  const showSpend = recap.spent_total != null && recap.spent_total > 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat icon={Ruler} label="Distance" value={formatDistance(recap.total_distance_meters, units)} />
        <Stat icon={Clock} label="Drive time" value={formatDuration(recap.total_drive_seconds)} />
        <Stat icon={CalendarDays} label="Days" value={String(recap.days_count)} />
        <Stat
          icon={MapPin}
          label="Stops visited"
          value={`${recap.stops_visited} / ${recap.stops_planned}`}
        />
        <Stat icon={Camera} label="Photos" value={String(recap.photo_count)} />
        {showSpend && (
          <Stat icon={Wallet} label="Spent" value={formatMoney(recap.spent_total as number, recap.currency ?? "USD")} />
        )}
      </div>

      {showSpend && recap.spent_by_category && (
        <ul className="flex flex-wrap gap-2 text-xs text-neutral-600">
          {Object.entries(recap.spent_by_category)
            .filter(([, v]) => v > 0)
            .map(([category, value]) => (
              <li key={category} className="rounded-full bg-neutral-100 px-3 py-1 capitalize">
                {category} {formatMoney(value, recap.currency ?? "USD")}
              </li>
            ))}
        </ul>
      )}
      {recap.stops_skipped > 0 && (
        <p className="text-sm text-neutral-500">{recap.stops_skipped} planned stop(s) skipped.</p>
      )}

      <ol className="flex flex-col gap-4">
        {recap.days.map((day) => (
          <li key={day.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
              <span className="text-xs font-bold uppercase text-neutral-400">Day {day.day_number}</span>
              {day.title && <span className="text-sm font-semibold text-neutral-800">{day.title}</span>}
              {day.date && (
                <span className="ml-auto text-xs text-neutral-500">
                  {new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-4 p-4">
              {day.notes && <p className="whitespace-pre-line text-sm text-neutral-700">{day.notes}</p>}
              <PhotoGrid photos={day.photos} />
              {day.stops.length === 0 && <p className="text-sm italic text-neutral-400">No stops</p>}
              <ul className="flex flex-col gap-4">
                {day.stops.map((stop) => (
                  <li key={stop.id} className="flex gap-3">
                    <span
                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        stop.visited ? "bg-green-600 text-white" : "bg-neutral-200 text-neutral-500"
                      }`}
                      aria-label={stop.visited ? "Visited" : stop.skipped ? "Skipped" : "Not visited"}
                    >
                      {stop.visited ? "✓" : "–"}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div>
                        <p className={`text-sm font-medium ${stop.visited ? "text-neutral-900" : "text-neutral-400"}`}>
                          {stop.label || stop.address}
                          {stop.skipped && <span className="ml-2 text-xs font-normal">(skipped)</span>}
                        </p>
                        {stop.visited_at && (
                          <p className="text-xs text-neutral-500">
                            {new Date(stop.visited_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </p>
                        )}
                      </div>
                      {stop.notes && <p className="whitespace-pre-line text-sm text-neutral-700">{stop.notes}</p>}
                      <PhotoGrid photos={stop.photos} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
