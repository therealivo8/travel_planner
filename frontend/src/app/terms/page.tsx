import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <PageShell>
      <article className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-neutral-700">
        <h1 className="text-2xl font-bold text-neutral-900">Terms of use</h1>
        <p>
          Road Trip Planner is a personal project, offered as is. By using it you agree to the
          following.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>No guarantees.</strong> There is no uptime guarantee, and features may change
            or be removed. Routes, drive times, weather and place information are estimates —
            check conditions and opening hours before you travel.
          </li>
          <li>
            <strong>Fair use.</strong> Discovery and routing rely on third-party services with
            free limits, so daily allowances apply. Don&apos;t try to bypass them or abuse the service.
          </li>
          <li>
            <strong>Your content.</strong> You own your trips. You&apos;re responsible for what you
            share publicly.
          </li>
          <li>
            <strong>Your data.</strong> You can export or delete it any time from{" "}
            <Link className="text-primary-600 hover:underline" href="/settings">
              Settings
            </Link>
            . See the{" "}
            <Link className="text-primary-600 hover:underline" href="/privacy">
              privacy page
            </Link>{" "}
            for how it&apos;s handled.
          </li>
          <li>
            <strong>Liability.</strong> To the extent the law allows, the service is provided
            without warranty and its author isn&apos;t liable for losses arising from its use.
          </li>
        </ul>
      </article>
    </PageShell>
  );
}
