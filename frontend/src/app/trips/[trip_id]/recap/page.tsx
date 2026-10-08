"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, apiErrorMessage } from "@/lib/api";
import { useUnits } from "@/hooks/useUnits";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageShell } from "@/components/layout/PageShell";
import { RecapView } from "@/components/memories/RecapView";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Recap } from "@/types";

export default function RecapPage({ params }: { params: Promise<{ trip_id: string }> }) {
  const { trip_id } = use(params);
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const units = useUnits();
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageTitle(recap ? `${recap.title} · Recap` : "Recap");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=/trips/${trip_id}/recap`);
      return;
    }
    api
      .get<Recap>(`/trips/${trip_id}/recap`)
      .then(setRecap)
      .catch((err) => setError(apiErrorMessage(err, "Couldn't load the recap")));
  }, [authLoading, user, router, trip_id]);

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/trips/${trip_id}`} aria-label="Back to trip">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-xl font-bold text-neutral-900">{recap?.title ?? "Trip recap"}</h1>
        </div>
        {error ? (
          <p className="text-sm text-neutral-600">{error}</p>
        ) : !recap ? (
          <Skeleton className="h-96 w-full rounded-xl" />
        ) : (
          <RecapView recap={recap} units={units} />
        )}
      </div>
    </PageShell>
  );
}
