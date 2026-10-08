import Link from "next/link";

/** Legal links and the attribution the map and routing providers require. */
export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-200 bg-white px-4 py-4 text-xs text-neutral-500">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex gap-4" aria-label="Legal">
          <Link href="/privacy" className="hover:text-neutral-800 hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-neutral-800 hover:underline">
            Terms
          </Link>
        </nav>
        <p>
          Map data © Google · Routing ©{" "}
          <a
            href="https://openrouteservice.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            openrouteservice.org
          </a>{" "}
          /{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            OpenStreetMap contributors
          </a>
        </p>
      </div>
    </footer>
  );
}
