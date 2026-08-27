import Link from "next/link";
import { MapPin, ArrowRight, Circle, Sparkles, ChevronDown } from "lucide-react";
import { Button, Badge } from "@/components/ui";

// Inline topographic SVG pattern — no image asset needed
function TopoPattern() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.06]"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern id="topo" width="60" height="60" patternUnits="userSpaceOnUse">
          <path
            d="M30 0 Q45 15 30 30 Q15 45 30 60 M0 30 Q15 15 30 30 Q45 45 60 30"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
          <path
            d="M0 15 Q15 0 30 15 Q45 30 60 15 M0 45 Q15 30 30 45 Q45 60 60 45"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.6"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#topo)" />
    </svg>
  );
}

const features = [
  {
    id: "point-to-point",
    icon: (
      <div className="flex items-center gap-1 text-primary-500">
        <div className="h-2.5 w-2.5 rounded-full bg-primary-500" />
        <div className="h-0.5 w-8 bg-primary-500" />
        <ArrowRight className="h-4 w-4 text-primary-500" />
        <div className="h-2.5 w-2.5 rounded-full bg-primary-500" />
      </div>
    ),
    title: "Point-to-Point",
    description:
      "Set your start and end points, add waypoints, and get a complete route with drive times and distances.",
    badge: null as string | null,
  },
  {
    id: "radius",
    icon: <Circle className="h-8 w-8 text-accent-400" />,
    title: "Radius Explorer",
    description:
      "Enter a center location and a max drive time. We surface every destination worth visiting within reach.",
    badge: null as string | null,
  },
  {
    id: "ai",
    icon: <Sparkles className="h-8 w-8 text-primary-500" />,
    title: "AI Trip Assistant",
    description:
      "Chat with an AI to get personalized stop suggestions, local tips, and a full itinerary drafted for you.",
    badge: "Coming soon" as string | null,
  },
];

const steps = [
  {
    number: "01",
    title: "Enter your starting point",
    description: "Tell us where you're starting from and how far you're willing to go.",
  },
  {
    number: "02",
    title: "Choose stops or let us find them",
    description: "Pick specific destinations or let Radius Explorer surface the best options nearby.",
  },
  {
    number: "03",
    title: "Hit the road with a full itinerary",
    description: "Get your complete route with drive times, distances, and stop details — ready to go.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white overflow-hidden">
        <TopoPattern />
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-900/80 via-neutral-900/60 to-neutral-900/90" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex justify-center mb-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500 shadow-lg">
              <MapPin className="h-7 w-7 text-white" />
            </div>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-none mb-6">
            Your next road trip,{" "}
            <span className="text-primary-400">planned.</span>
          </h1>
          <p className="text-lg sm:text-xl text-neutral-300 max-w-2xl mx-auto mb-10">
            Two planning modes. Infinite possibilities. Start from anywhere.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" asChild className="w-full sm:w-auto">
              <Link href="/register">Get Started</Link>
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full sm:w-auto text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <a href="#features">See how it works</a>
            </Button>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="h-5 w-5 text-neutral-500" />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 bg-neutral-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-neutral-900 mb-4">
              Two ways to plan your trip
            </h2>
            <p className="text-neutral-500 text-lg max-w-xl mx-auto">
              Whether you know your destination or want to discover what&apos;s out there, we have
              the right tool for you.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.id}
                className="relative rounded-xl border border-neutral-200 bg-white p-8 flex flex-col gap-4 hover:shadow-md transition-shadow"
              >
                <div className="h-12 flex items-center">{feature.icon}</div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-neutral-900">{feature.title}</h3>
                  {feature.badge && (
                    <Badge variant="outline" className="text-xs">
                      {feature.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-neutral-500 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 bg-white border-t border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-neutral-900 mb-4">How it works</h2>
            <p className="text-neutral-500 text-lg max-w-xl mx-auto">
              From blank slate to packed itinerary in minutes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step) => (
              <div key={step.number} className="flex flex-col items-start gap-4">
                <span className="font-mono text-5xl font-bold text-primary-100 select-none">
                  {step.number}
                </span>
                <h3 className="text-lg font-semibold text-neutral-900">{step.title}</h3>
                <p className="text-neutral-500 text-sm leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 text-center">
            <Button size="lg" asChild>
              <Link href="/register">Start planning for free</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-neutral-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex flex-col items-center md:items-start gap-1">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-500">
                  <MapPin className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="font-semibold text-neutral-900">Road Trip Planner</span>
              </div>
              <p className="text-xs text-neutral-500">Your next adventure, meticulously planned.</p>
            </div>

            <nav className="flex items-center gap-6 text-sm text-neutral-500">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-neutral-900 transition-colors"
              >
                GitHub
              </a>
            </nav>

            <p className="text-xs text-neutral-400">Built with Claude</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
