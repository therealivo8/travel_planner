import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Road Trip Planner",
    short_name: "Road Trip",
    description: "Plan your road trip, take it with you, and remember it.",
    start_url: "/trips",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#3B82F6", // --color-primary
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
