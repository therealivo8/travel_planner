import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The service worker must always be re-checked so updates reach users promptly.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    return {
      // fallback runs after Route Handlers, so /api/auth/* Route Handlers
      // take precedence and can forward Set-Cookie to the browser.
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backend}/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
