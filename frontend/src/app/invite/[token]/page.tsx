"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, apiErrorMessage } from "@/lib/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import { AuthCard } from "@/components/layout/AuthCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvitePreview, TripRole } from "@/types";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { user, isLoading } = useAuth();
  usePageTitle("Trip invitation");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [joining, setJoining] = useState(false);
  const next = `/invite/${token}`;

  useEffect(() => {
    // The preview is public (the token is the secret), so it shows before sign-in.
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<InvitePreview>) : { valid: false, trip_title: null, owner_name: null, role: null }))
      .then(setPreview)
      .catch(() => setPreview({ valid: false, trip_title: null, owner_name: null, role: null }));
  }, [token]);

  async function accept() {
    setJoining(true);
    try {
      const res = await api.post<{ trip_id: string; role: TripRole }>(`/invites/${token}/accept`);
      toast.success(res.role === "owner" ? "That's your own trip." : `You joined as ${res.role}.`);
      router.push(`/trips/${res.trip_id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "This invite link is invalid or has expired"));
      setJoining(false);
    }
  }

  if (!preview || isLoading) {
    return (
      <AuthCard title="Trip invitation">
        <Skeleton className="h-24 w-full" />
      </AuthCard>
    );
  }

  if (!preview.valid) {
    return (
      <AuthCard title="Invite not valid">
        <p className="text-sm text-neutral-600">
          This invite link has expired, was revoked, or has been used up. Ask the trip owner for a new one.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/trips">Go to my trips</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={preview.trip_title ?? "Road trip"}
      subtitle={`${preview.owner_name} invited you to join as ${preview.role === "editor" ? "an editor" : "a viewer"}.`}
    >
      <p className="mb-6 text-sm text-neutral-600">
        {preview.role === "editor"
          ? "Editors can change stops and the itinerary, vote and comment."
          : "Viewers can see the whole plan, vote and comment."}
      </p>
      {user ? (
        <Button className="w-full" onClick={accept} disabled={joining}>
          {joining ? "Joining…" : "Join this trip"}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in to join</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link>
          </Button>
        </div>
      )}
    </AuthCard>
  );
}
