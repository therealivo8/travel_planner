"use client";

import { ArrowRight, Clock, Ruler, CalendarDays, MapPin } from "lucide-react";
import type { PublicTrip, ItineraryDay } from "@/types";

interface SharedTripViewProps {
  trip: PublicTrip;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDistance(meters: number | null): string {
  if (meters == null) return "—";
  return `${(meters / 1609.34).toFixed(0)} mi`;
}

function DaySection({ day }: { day: ItineraryDay }) {
  return (
    <div className="border border-neutral-200 rounded-xl overflow-hidden">
      <div className="bg-neutral-50 px-4 py-3 flex items-center gap-3 border-b border-neutral-200">
        <span className="text-xs font-bold text-neutral-400 uppercase">Day {day.day_number}</span>
        {day.title && <span className="text-sm font-semibold text-neutral-800">{day.title}</span>}
        {day.date && (
          <span className="text-xs text-neutral-500 ml-auto flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {new Date(day.date).toLocaleDateString()}
          </span>
        )}
      </div>
      {day.notes && (
        <p className="px-4 py-2 text-xs text-neutral-500 italic border-b border-neutral-100">
          {day.notes}
        </p>
      )}
      <div className="divide-y divide-neutral-100">
        {day.waypoints.length === 0 && (
          <p className="px-4 py-3 text-xs text-neutral-400 italic">No stops planned</p>
        )}
        {day.waypoints.map((wp) => (
          <div key={wp.id} className="px-4 py-3 flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-primary-400 shrink-0" />
            <span className="text-sm text-neutral-800 flex-1">{wp.label || wp.address}</span>
            {wp.scheduled_arrival_time && (
              <span className="text-xs text-neutral-500 shrink-0">{wp.scheduled_arrival_time}</span>
            )}
            {wp.drive_seconds_from_prev != null && (
              <span className="text-xs text-neutral-400 shrink-0">
                +{formatDuration(wp.drive_seconds_from_prev)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SharedTripView({ trip }: SharedTripViewProps) {
  const sortedDays = [...(trip.days ?? [])].sort((a, b) => a.day_number - b.day_number);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Hero */}
      <div
        className="relative h-48 sm:h-64 bg-gradient-to-br from-primary-500 via-primary-600 to-accent-500"
        style={
          trip.cover_image_url
            ? { backgroundImage: `url(${trip.cover_image_url})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      >
        <div className="absolute inset-0 bg-black/30" />
        <div className="relative z-10 h-full flex flex-col justify-end px-6 pb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white drop-shadow">{trip.title}</h1>
          {trip.start_date && (
            <p className="text-sm text-white/80 mt-1">
              {new Date(trip.start_date).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: Ruler, label: "Distance", value: formatDistance(trip.total_distance_meters) },
            { icon: Clock, label: "Drive time", value: formatDuration(trip.total_drive_seconds) },
            { icon: CalendarDays, label: "Days", value: sortedDays.length > 0 ? String(sortedDays.length) : "—" },
            { icon: MapPin, label: "Stops", value: String(trip.waypoints.length) },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-neutral-200 p-3 text-center">
              <Icon className="h-4 w-4 text-neutral-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-neutral-900">{value}</p>
              <p className="text-xs text-neutral-500">{label}</p>
            </div>
          ))}
        </div>

        {/* Route */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">Route</p>
          <div className="flex items-start gap-2">
            <div className="mt-1 h-2.5 w-2.5 rounded-full bg-green-500 shrink-0" />
            <p className="text-sm text-neutral-700">{trip.start_address}</p>
          </div>
          {trip.waypoints.length > 0 && (
            <div className="ml-1 border-l-2 border-dashed border-neutral-200 pl-3 py-1 flex flex-col gap-1 my-1">
              {trip.waypoints.map((wp) => (
                <p key={wp.id} className="text-xs text-neutral-500 truncate">
                  {wp.label ?? wp.address}
                </p>
              ))}
            </div>
          )}
          {trip.end_address && (
            <div className="flex items-start gap-2 mt-1">
              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-red-500 shrink-0" />
              <p className="text-sm text-neutral-700">{trip.end_address}</p>
            </div>
          )}
        </div>

        {/* Itinerary */}
        {sortedDays.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">
              Itinerary
            </p>
            <div className="flex flex-col gap-3">
              {sortedDays.map((day) => (
                <DaySection key={day.id} day={day} />
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-neutral-400 py-4">
          Shared via Road Trip Planner &bull; Read-only view
        </p>
      </div>
    </div>
  );
}
