/**
 * Client-side (browser) Sentry instrumentation. Next.js loads this after the
 * HTML document loads but before React hydration — see
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client.
 *
 * No-ops when NEXT_PUBLIC_SENTRY_DSN is unset (the default). This DSN is
 * meant to be public — Sentry DSNs are write-only and rate-limited per
 * project, unlike NEXT_PUBLIC_MAPS_API_KEY's referrer-restriction model or
 * a real secret — see docs/security-alerting.md.
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
