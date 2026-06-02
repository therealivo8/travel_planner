"use client";

import { APIProvider } from "@vis.gl/react-google-maps";

const MAPS_API_KEY = process.env.NEXT_PUBLIC_MAPS_API_KEY ?? "";

export function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
  return <APIProvider apiKey={MAPS_API_KEY}>{children}</APIProvider>;
}
