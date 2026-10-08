import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <PageShell>
      <article className="prose-sm mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-neutral-700">
        <h1 className="text-2xl font-bold text-neutral-900">Privacy</h1>
        <p>
          Road Trip Planner is a personal project. This page explains what it stores and who
          receives your data.
        </p>

        <h2 className="pt-2 text-base font-semibold text-neutral-900">What we store</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your email address, display name and a hashed password (never the password itself).</li>
          <li>
            Your trips: titles, notes, start and end addresses, stops, itinerary days, expenses
            and packing lists, plus your preferences (units, home address, default stop length).
          </li>
          <li>Counters of how many map lookups you have used each day, to keep usage within free limits.</li>
          <li>Error and security logs (for example IP addresses on failed logins) kept to run and protect the service.</li>
        </ul>

        <h2 className="pt-2 text-base font-semibold text-neutral-900">Who receives your data</h2>
        <p>To provide the features, addresses and coordinates you enter are sent to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Google Maps Platform</strong> — address search, geocoding, routes, drive times
            and nearby places. Google acts as a data processor under{" "}
            <a className="text-primary-600 hover:underline" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Google&apos;s privacy policy
            </a>
            .
          </li>
          <li>
            <strong>OpenRouteService</strong> (HeiGIT) — drive-time areas for Radius Explorer,
            based on OpenStreetMap data.
          </li>
          <li>
            <strong>Open-Meteo</strong> — weather forecasts, using the coordinates of a day&apos;s
            last stop. No account information is sent.
          </li>
          <li>
            <strong>Resend</strong> — delivers password-reset emails to your address.
          </li>
          <li>
            <strong>Sentry</strong> — receives error reports so problems can be fixed.
          </li>
        </ul>
        <p>We don&apos;t sell your data or use it for advertising.</p>

        <h2 className="pt-2 text-base font-semibold text-neutral-900">Sharing</h2>
        <p>
          A trip is private unless you turn on sharing, which creates a link anyone can open
          read-only. Turning sharing off disables the link.
        </p>

        <h2 className="pt-2 text-base font-semibold text-neutral-900">Your choices</h2>
        <p>
          You can download all your data or permanently delete your account and every trip from{" "}
          <Link className="text-primary-600 hover:underline" href="/settings">
            Settings
          </Link>
          .
        </p>

        <h2 className="pt-2 text-base font-semibold text-neutral-900">Attribution</h2>
        <p>
          Map data © Google. Routing © openrouteservice.org / OpenStreetMap contributors. Weather
          data by Open-Meteo.com.
        </p>
      </article>
    </PageShell>
  );
}
