import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PublicTrip } from "@/types";
import { SharedTripView } from "./SharedTripView";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchSharedTrip(token: string): Promise<PublicTrip | null> {
  try {
    const res = await fetch(`${API_URL}/shared/${token}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<PublicTrip>;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const trip = await fetchSharedTrip(token);

  if (!trip) {
    return { title: "Trip not found" };
  }

  const distMi = trip.total_distance_meters
    ? (trip.total_distance_meters / 1609.34).toFixed(0)
    : null;
  const description = [
    `From ${trip.start_address}`,
    trip.end_address ? `to ${trip.end_address}` : null,
    distMi ? `• ${distMi} mi` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: trip.title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: trip.title,
      description,
      type: "website",
      images: trip.cover_image_url ? [{ url: trip.cover_image_url }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title: trip.title,
      description,
    },
  };
}

export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const trip = await fetchSharedTrip(token);

  if (!trip) notFound();

  return <SharedTripView trip={trip} />;
}
