/**
 * Server-side Sentry instrumentation.
 *
 * Next.js calls `register()` once when a new server instance starts, and
 * `onRequestError()` on every server-side error (Server Components, Route
 * Handlers, Server Actions, and the proxy/middleware layer) — see
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation.
 *
 * Both are no-ops when NEXT_PUBLIC_SENTRY_DSN is unset (the default), so
 * local dev and CI never need a Sentry account — mirrors the backend's
 * SENTRY_DSN gating in backend/app/core/sentry.py.
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      // Low-traffic personal project — full trace sampling would add cost
      // and noise with no real performance-debugging benefit. Error capture
      // (the actual goal here) is unaffected by this setting.
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
