import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/PageShell";

interface StatusPageProps {
  heading: string;
  message: string;
  /** Extra action (e.g. "Try again") shown before the link back to the trips list. */
  action?: React.ReactNode;
}

/** Shared body for 404 and error screens, always with a way back to /trips. */
export function StatusPage({ heading, message, action }: StatusPageProps) {
  return (
    <PageShell>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="text-2xl font-bold text-neutral-900">{heading}</h1>
        <p className="mt-2 max-w-sm text-sm text-neutral-500">{message}</p>
        <div className="mt-6 flex gap-2">
          {action}
          <Button asChild variant={action ? "outline" : "default"}>
            <Link href="/trips">Back to my trips</Link>
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
