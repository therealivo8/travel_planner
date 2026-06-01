"use client";

import { notFound } from "next/navigation";
import * as React from "react";
import {
  Button,
  Input,
  Textarea,
  Badge,
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Separator,
  Skeleton,
  Progress,
  Avatar, AvatarFallback,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription,
  Tooltip, TooltipProvider, TooltipTrigger, TooltipContent,
} from "@/components/ui";
import { TripCard } from "@/components/trips";
import { StatPill, EmptyState, LoadingOverlay } from "@/components/common";
import { ModeSelector } from "@/components/planning";
import { TopNav } from "@/components/layout";
import { Toaster } from "sonner";
import { toast } from "sonner";

// Block access in production
if (process.env.NODE_ENV === "production") {
  notFound();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-10 border-b border-neutral-200 last:border-0">
      <h2 className="text-xl font-semibold text-neutral-900 mb-6">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ token, hex, usage }: { token: string; hex: string; usage: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-12 w-full rounded-lg border border-neutral-200" style={{ background: hex }} />
      <p className="text-xs font-mono text-neutral-900">{token}</p>
      <p className="text-xs text-neutral-500">{hex}</p>
      <p className="text-xs text-neutral-400 leading-tight">{usage}</p>
    </div>
  );
}

export default function DesignPage() {
  const [mode, setMode] = React.useState<"point-to-point" | "radius" | null>(null);

  return (
    <TooltipProvider>
      <Toaster />
      <div className="min-h-screen bg-neutral-50">
        {/* Header */}
        <div className="bg-neutral-900 text-white py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-mono text-neutral-400 mb-1">DEV ONLY — /design</p>
            <h1 className="text-3xl font-bold">Design System</h1>
            <p className="text-neutral-400 mt-1 text-sm">
              Component library reference for Road Trip Planner. All colors reference Tailwind tokens.
            </p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* ── 1. Colors ── */}
          <Section title="1. Colors">
            <div className="space-y-6">
              <div>
                <p className="text-sm font-medium text-neutral-500 mb-3">Primary — Road Blue</p>
                <div className="grid grid-cols-5 gap-3">
                  <Swatch token="primary-50" hex="#EFF6FF" usage="subtle backgrounds" />
                  <Swatch token="primary-100" hex="#DBEAFE" usage="hover states" />
                  <Swatch token="primary-500" hex="#3B82F6" usage="default buttons, links" />
                  <Swatch token="primary-600" hex="#2563EB" usage="button hover" />
                  <Swatch token="primary-700" hex="#1D4ED8" usage="pressed / active" />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500 mb-3">Accent — Trail Amber</p>
                <div className="grid grid-cols-5 gap-3">
                  <Swatch token="accent-400" hex="#FBBF24" usage="highlights, badges, markers" />
                  <Swatch token="accent-500" hex="#F59E0B" usage="accent hover" />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500 mb-3">Neutral — Stone</p>
                <div className="grid grid-cols-5 gap-3">
                  <Swatch token="neutral-50" hex="#FAFAF9" usage="page background" />
                  <Swatch token="neutral-100" hex="#F5F5F4" usage="card backgrounds" />
                  <Swatch token="neutral-200" hex="#E7E5E4" usage="borders, dividers" />
                  <Swatch token="neutral-500" hex="#78716C" usage="secondary text" />
                  <Swatch token="neutral-900" hex="#1C1917" usage="primary text" />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-500 mb-3">Semantic</p>
                <div className="grid grid-cols-5 gap-3">
                  <Swatch token="success-500" hex="#22C55E" usage="route calculated, saved" />
                  <Swatch token="warning-500" hex="#F59E0B" usage="draft status" />
                  <Swatch token="error-500" hex="#EF4444" usage="validation errors" />
                </div>
              </div>
            </div>
          </Section>

          {/* ── 2. Typography ── */}
          <Section title="2. Typography">
            <div className="space-y-4 bg-white rounded-xl border border-neutral-200 p-8">
              <p className="text-6xl font-extrabold text-neutral-900 leading-none">Display — 800 / 3.75rem</p>
              <p className="text-4xl font-bold text-neutral-900">Heading H1 — 700 / 2.25rem</p>
              <p className="text-2xl font-semibold text-neutral-900">Heading H2 — 600 / 1.5rem</p>
              <p className="text-xl font-semibold text-neutral-900">Heading H3 — 600 / 1.25rem</p>
              <p className="text-base text-neutral-900">Body — 400 / 1rem — The quick brown fox jumps over the lazy dog</p>
              <p className="text-sm text-neutral-500">Small / Caption — 400 / 0.875rem — Secondary information and metadata</p>
              <p className="text-sm font-mono text-neutral-900">Mono (JetBrains) — 37.4° N, 122.0° W — 4h 32min — 280 mi</p>
            </div>
          </Section>

          {/* ── 3. Buttons ── */}
          <Section title="3. Buttons">
            <div className="space-y-4">
              <div>
                <p className="text-xs text-neutral-500 mb-3">Variants</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="default">Default</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="destructive">Destructive</Button>
                  <Button variant="accent">Accent</Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-neutral-500 mb-3">Sizes</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm">Small</Button>
                  <Button size="default">Default</Button>
                  <Button size="lg">Large</Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-neutral-500 mb-3">Disabled</p>
                <div className="flex flex-wrap gap-3">
                  <Button disabled>Default</Button>
                  <Button variant="secondary" disabled>Secondary</Button>
                  <Button variant="outline" disabled>Outline</Button>
                </div>
              </div>
            </div>
          </Section>

          {/* ── 4. Form Elements ── */}
          <Section title="4. Form Elements">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
              <Input label="Trip Name" placeholder="My summer road trip" />
              <Input label="With Error" placeholder="Enter value" error="This field is required" />
              <Textarea label="Notes" placeholder="Any notes about the trip..." />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-neutral-900">Avatar</label>
                <div className="flex items-center gap-3">
                  <Avatar><AvatarFallback>JD</AvatarFallback></Avatar>
                  <Avatar className="h-8 w-8"><AvatarFallback>AB</AvatarFallback></Avatar>
                </div>
              </div>
            </div>
          </Section>

          {/* ── 5. Badges ── */}
          <Section title="5. Badges">
            <div className="flex flex-wrap gap-3">
              <Badge variant="default">Default</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="draft">Draft</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>
          </Section>

          {/* ── 6. Cards ── */}
          <Section title="6. Cards">
            <div className="space-y-8">
              <div>
                <p className="text-xs text-neutral-500 mb-3">Base Card</p>
                <Card className="max-w-sm">
                  <CardHeader>
                    <CardTitle>Card Title</CardTitle>
                    <CardDescription>A short description of the card content.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-neutral-700">Card body content goes here.</p>
                  </CardContent>
                  <CardFooter className="gap-2">
                    <Button size="sm">Action</Button>
                    <Button size="sm" variant="ghost">Cancel</Button>
                  </CardFooter>
                </Card>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">TripCard — with stats</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl">
                  <TripCard
                    title="Pacific Coast Highway"
                    mode="point-to-point"
                    status="planned"
                    distanceMi={650}
                    driveTimeMin={720}
                    stopCount={5}
                    updatedAt={new Date()}
                  />
                  <TripCard
                    title="Weekend Radius Explore — Bay Area"
                    mode="radius"
                    status="draft"
                    updatedAt={new Date()}
                  />
                  <TripCard
                    title="Route 66 Complete"
                    mode="point-to-point"
                    status="completed"
                    distanceMi={2278}
                    driveTimeMin={2100}
                    stopCount={12}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">StatPill</p>
                <div className="flex flex-wrap gap-6 p-4 bg-white rounded-xl border border-neutral-200">
                  <StatPill icon="🕐" value="4h 32min" />
                  <StatPill icon="📍" value="280" unit="mi" />
                  <StatPill icon="🚏" value="3" unit="stops" />
                </div>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">ModeSelector</p>
                <ModeSelector value={mode} onChange={setMode} className="max-w-xl" />
              </div>
            </div>
          </Section>

          {/* ── 7. Feedback ── */}
          <Section title="7. Feedback">
            <div className="space-y-8">
              <div>
                <p className="text-xs text-neutral-500 mb-3">Toast (via Sonner)</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={() => toast("Trip saved successfully")}>
                    Default Toast
                  </Button>
                  <Button variant="outline" onClick={() => toast.success("Route calculated!")}>
                    Success Toast
                  </Button>
                  <Button variant="outline" onClick={() => toast.error("Something went wrong")}>
                    Error Toast
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">LoadingOverlay</p>
                <div className="bg-white rounded-xl border border-neutral-200">
                  <LoadingOverlay message="Calculating your route..." />
                </div>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">EmptyState</p>
                <div className="bg-white rounded-xl border border-neutral-200">
                  <EmptyState
                    icon="🗺️"
                    heading="No trips yet"
                    subtext="Start planning your first road trip. Pick a mode and let's go."
                    cta={{ label: "Create Trip", onClick: () => {} }}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">Skeleton</p>
                <div className="flex flex-col gap-3 max-w-sm">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-32 w-full rounded-xl" />
                </div>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">Progress</p>
                <div className="flex flex-col gap-3 max-w-sm">
                  <Progress value={30} />
                  <Progress value={65} />
                  <Progress value={90} />
                </div>
              </div>
            </div>
          </Section>

          {/* ── 8. Modals & Sheets ── */}
          <Section title="8. Modals & Sheets">
            <div className="flex flex-wrap gap-4">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Open Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Trip</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to delete this trip? This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Delete</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline">Open Sheet (right)</Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Trip Details</SheetTitle>
                    <SheetDescription>Edit your trip settings and preferences.</SheetDescription>
                  </SheetHeader>
                  <div className="mt-6 flex flex-col gap-4">
                    <Input label="Trip Name" defaultValue="Pacific Coast Highway" />
                    <Textarea label="Notes" placeholder="Add notes..." />
                    <Button>Save Changes</Button>
                  </div>
                </SheetContent>
              </Sheet>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">Hover for Tooltip</Button>
                  </TooltipTrigger>
                  <TooltipContent>This is a tooltip message</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </Section>

          {/* ── 9. Navigation ── */}
          <Section title="9. Navigation">
            <div className="space-y-6">
              <div>
                <p className="text-xs text-neutral-500 mb-3">TopNav (full-width preview)</p>
                <div className="rounded-xl overflow-hidden border border-neutral-200">
                  <TopNav />
                </div>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">Tabs</p>
                <Tabs defaultValue="tab1" className="max-w-md">
                  <TabsList>
                    <TabsTrigger value="tab1">Route</TabsTrigger>
                    <TabsTrigger value="tab2">Stops</TabsTrigger>
                    <TabsTrigger value="tab3">Settings</TabsTrigger>
                  </TabsList>
                  <TabsContent value="tab1" className="p-4 bg-white rounded-lg border border-neutral-200">
                    Route tab content
                  </TabsContent>
                  <TabsContent value="tab2" className="p-4 bg-white rounded-lg border border-neutral-200">
                    Stops tab content
                  </TabsContent>
                  <TabsContent value="tab3" className="p-4 bg-white rounded-lg border border-neutral-200">
                    Settings tab content
                  </TabsContent>
                </Tabs>
              </div>

              <div>
                <p className="text-xs text-neutral-500 mb-3">Separator</p>
                <div className="max-w-sm flex flex-col gap-3">
                  <span className="text-sm text-neutral-700">Above</span>
                  <Separator />
                  <span className="text-sm text-neutral-700">Below</span>
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </TooltipProvider>
  );
}
