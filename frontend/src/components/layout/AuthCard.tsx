import Link from "next/link";
import { MapPin } from "lucide-react";

/** Centered card used by the logged-out account screens (forgot/reset password). */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2" aria-label="Road Trip Planner home">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500">
              <MapPin className="h-5 w-5 text-white" />
            </div>
          </Link>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-8">
          <h1 className="text-2xl font-bold text-neutral-900 mb-1">{title}</h1>
          {subtitle && <p className="text-sm text-neutral-500 mb-6">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
