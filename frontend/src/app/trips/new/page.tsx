"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Circle, ArrowRight } from "lucide-react";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AddressAutocomplete, GoogleMapsProvider } from "@/components/routing";
import type { AddressSelection } from "@/components/routing";
import type { Trip } from "@/types";
import { PageShell } from "@/components/layout/PageShell";

type Mode = "point_to_point" | "radius";

const baseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  start_address: z.string().min(1, "Start address is required"),
  start_lat: z.number({ error: "Select a start address from the dropdown" }),
  start_lng: z.number({ error: "Select a start address from the dropdown" }),
  notes: z.string().optional(),
});

const pointToPointSchema = baseSchema.extend({
  end_address: z.string().min(1, "End address is required"),
  end_lat: z.number({ error: "Select an end address from the dropdown" }),
  end_lng: z.number({ error: "Select an end address from the dropdown" }),
});

const radiusSchema = baseSchema.extend({
  max_drive_minutes: z
    .number({ error: "Invalid number" })
    .int()
    .positive("Must be a positive number")
    .max(60, "Maximum is 60 minutes (ORS free tier limit)"),
});

type FieldErrors = Partial<Record<string, string>>;

export default function NewTripPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login?next=/trips/new");
    }
  }, [authLoading, user, router]);

  const [mode, setMode] = useState<Mode>("point_to_point");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [maxDriveMinutes, setMaxDriveMinutes] = useState("");
  const [start, setStart] = useState<AddressSelection | null>(null);
  const [end, setEnd] = useState<AddressSelection | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const raw = {
      title,
      start_address: start?.address ?? "",
      start_lat: start?.lat,
      start_lng: start?.lng,
      notes: notes || undefined,
      ...(mode === "point_to_point"
        ? {
            end_address: end?.address ?? "",
            end_lat: end?.lat,
            end_lng: end?.lng,
          }
        : { max_drive_minutes: maxDriveMinutes ? Number(maxDriveMinutes) : undefined }),
    };

    const schema = mode === "point_to_point" ? pointToPointSchema : radiusSchema;
    const result = schema.safeParse(raw);
    if (!result.success) {
      const fe = result.error.flatten().fieldErrors;
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])));
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const trip = await api.post<Trip>("/trips", { ...result.data, mode });
      if (mode === "point_to_point") {
        try {
          await api.post(`/trips/${trip.id}/calculate-route`);
        } catch {
          // Route calculation failure is non-fatal — user can retry on the detail page
        }
        router.push(`/trips/${trip.id}`);
      } else {
        // Radius trips go to the discover page to run POI discovery
        router.push(`/trips/${trip.id}/discover`);
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to create trip");
    } finally {
      setPending(false);
    }
  }

  return (
    <GoogleMapsProvider>
      <PageShell fullBleed>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 w-full">
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/trips">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-xl font-semibold text-neutral-900">New Trip</h1>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
            {/* Mode selector */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5">
              <p className="text-sm font-medium text-neutral-700 mb-3">Trip type</p>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    {
                      value: "point_to_point" as Mode,
                      label: "Point-to-Point",
                      description: "Known start and end",
                      icon: <ArrowRight className="h-4 w-4 text-primary-500" />,
                    },
                    {
                      value: "radius" as Mode,
                      label: "Radius Explorer",
                      description: "Explore within drive time",
                      icon: <Circle className="h-4 w-4 text-accent-500" />,
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value)}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border-2 p-4 text-left transition-colors",
                      mode === opt.value
                        ? "border-primary-500 bg-primary-50"
                        : "border-neutral-200 hover:border-neutral-300"
                    )}
                  >
                    {opt.icon}
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{opt.label}</p>
                      <p className="text-xs text-neutral-500">{opt.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Basic fields */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5 flex flex-col gap-4">
              <p className="text-sm font-medium text-neutral-700">Trip details</p>

              <Field label="Title" error={errors.title}>
                <Input
                  placeholder="e.g. Pacific Coast Highway"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-invalid={!!errors.title}
                />
              </Field>

              <Field label="Start address" error={errors.start_address || errors.start_lat}>
                <AddressAutocomplete
                  value={start?.address ?? ""}
                  placeholder="City, State or full address"
                  onSelect={(r) => {
                    setStart(r);
                    setErrors((prev) => ({ ...prev, start_address: undefined, start_lat: undefined }));
                  }}
                  aria-invalid={!!(errors.start_address || errors.start_lat)}
                />
              </Field>
            </div>

            {/* Point-to-point destination */}
            {mode === "point_to_point" && (
              <div className="bg-white rounded-xl border border-neutral-200 p-5 flex flex-col gap-4">
                <p className="text-sm font-medium text-neutral-700">Destination</p>
                <Field label="End address" error={errors.end_address || errors.end_lat}>
                  <AddressAutocomplete
                    value={end?.address ?? ""}
                    placeholder="City, State or full address"
                    onSelect={(r) => {
                      setEnd(r);
                      setErrors((prev) => ({ ...prev, end_address: undefined, end_lat: undefined }));
                    }}
                    aria-invalid={!!(errors.end_address || errors.end_lat)}
                  />
                </Field>
              </div>
            )}

            {/* Radius settings */}
            {mode === "radius" && (
              <div className="bg-white rounded-xl border border-neutral-200 p-5 flex flex-col gap-4">
                <p className="text-sm font-medium text-neutral-700">Radius settings</p>
                <Field label="Max drive time (minutes)" error={errors.max_drive_minutes}>
                  <Input
                    type="number"
                    min={1}
                    placeholder="120"
                    value={maxDriveMinutes}
                    onChange={(e) => setMaxDriveMinutes(e.target.value)}
                    aria-invalid={!!errors.max_drive_minutes}
                  />
                </Field>
              </div>
            )}

            {/* Notes */}
            <div className="bg-white rounded-xl border border-neutral-200 p-5">
              <Field label="Notes (optional)" error={errors.notes}>
                <Textarea
                  placeholder="Any extra details about this trip…"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </div>

            {serverError && (
              <p className="text-sm text-error-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {serverError}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="w-full sm:w-auto sm:self-end"
            >
              {pending ? "Creating…" : "Create trip"}
            </Button>
          </form>
        </div>
      </PageShell>
    </GoogleMapsProvider>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-neutral-700">{label}</label>
      {children}
      {error && <p className="text-xs text-error-500">{error}</p>}
    </div>
  );
}
