import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
