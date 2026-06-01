# PRD — Phase 0: Design System & Visual Foundation

## Overview
Define and build the visual language for the Road Trip Planner before any feature work begins. This phase produces a design system — color palette, typography, spacing scale, component library, and layout patterns — that every subsequent phase inherits. The deliverable is a living `/design` route in the Next.js app that renders all base components so any agent can see what's available before building a feature page.

## Prerequisites
- None. This phase runs before Phase 1 infrastructure work, OR can be completed alongside it since it is purely frontend.
- In practice: Next.js app must be bootstrapped with Tailwind before this phase can be implemented. Coordinate with Phase 1 if running concurrently.

## Goals
- A clear, consistent visual identity exists before any feature UI is built.
- All agents in Phases 1–6 can reference this PRD (and the `/design` page) rather than making ad-hoc style decisions.
- The component library covers every primitive needed across all phases: buttons, inputs, cards, modals, maps, badges, sidebars.
- The app feels like a premium travel product — clean, open, confident — not a generic CRUD app.

## Out of Scope
- Any backend work.
- Page-level layouts for specific features (those live in their respective phase PRDs).
- Dark mode (can be added post-Phase 6).
- Animations beyond simple transitions.

---

## Visual Identity

### Personality
Adventurous but trustworthy. Open road, natural landscapes, forward motion. Think: a well-designed atlas, not a generic SaaS dashboard.

### Color Palette
All colors defined as Tailwind CSS custom tokens in `tailwind.config.ts`.

**Primary — Road Blue**
| Token | Hex | Usage |
|---|---|---|
| `primary-50` | `#EFF6FF` | subtle backgrounds |
| `primary-100` | `#DBEAFE` | hover states |
| `primary-500` | `#3B82F6` | default buttons, links |
| `primary-600` | `#2563EB` | button hover |
| `primary-700` | `#1D4ED8` | pressed / active |

**Accent — Trail Amber**
| Token | Hex | Usage |
|---|---|---|
| `accent-400` | `#FBBF24` | highlights, badges, map markers |
| `accent-500` | `#F59E0B` | accent hover |

**Neutral — Stone**
| Token | Hex | Usage |
|---|---|---|
| `neutral-50` | `#FAFAF9` | page background |
| `neutral-100` | `#F5F5F4` | card backgrounds |
| `neutral-200` | `#E7E5E4` | borders, dividers |
| `neutral-500` | `#78716C` | secondary text |
| `neutral-900` | `#1C1917` | primary text |

**Semantic**
| Token | Hex | Usage |
|---|---|---|
| `success-500` | `#22C55E` | route calculated, saved |
| `warning-500` | `#F59E0B` | draft status |
| `error-500` | `#EF4444` | validation errors |

### Typography
Font stack defined in `src/app/layout.tsx` via `next/font/google`.

| Role | Font | Weight | Size |
|---|---|---|---|
| Display (hero headings) | Inter | 800 | 3rem–4.5rem |
| Heading H1 | Inter | 700 | 2rem |
| Heading H2 | Inter | 600 | 1.5rem |
| Heading H3 | Inter | 600 | 1.25rem |
| Body | Inter | 400 | 1rem |
| Small / Caption | Inter | 400 | 0.875rem |
| Mono (coordinates, stats) | JetBrains Mono | 400 | 0.875rem |

### Spacing & Layout
- Base spacing unit: 4px (Tailwind default).
- Page max-width: `1280px` (`max-w-7xl`), centered with `mx-auto px-4 sm:px-6 lg:px-8`.
- Card border radius: `rounded-xl` (12px).
- Input border radius: `rounded-lg` (8px).
- Button border radius: `rounded-lg` (8px).

---

## Component Library

Use **shadcn/ui** as the base component layer. It generates unstyled Radix UI primitives into `src/components/ui/` which are then styled with Tailwind — no runtime CSS-in-JS, fully customizable, tree-shakeable.

Install with: `pnpm dlx shadcn@latest init`

### Components to Install & Customize from shadcn/ui
- `Button` — variants: `default`, `secondary`, `outline`, `ghost`, `destructive`
- `Input` — with label and error state support
- `Textarea`
- `Select` / `Combobox`
- `Dialog` (Modal)
- `Sheet` (slide-in panel — used for mobile sidebar and AI chat)
- `Tabs`
- `Badge` — variants: `default`, `outline`, `success`, `warning`, `draft`
- `Card` (with `CardHeader`, `CardContent`, `CardFooter`)
- `Separator`
- `Skeleton` (loading states)
- `Toast` / `Sonner` (notifications)
- `Dropdown Menu`
- `Avatar`
- `Progress`
- `Tooltip`

### Custom Components (not in shadcn/ui)

#### `PageShell`
Top-level layout wrapper used on every authenticated page.
```
┌─────────────────────────────────────────┐
│  TopNav (logo + user menu)              │
├─────────────────────────────────────────┤
│  [optional PageHeader: title + actions] │
├─────────────────────────────────────────┤
│  {children}                             │
│                                         │
│                                         │
└─────────────────────────────────────────┘
```
Props: `title?: string`, `actions?: ReactNode`, `fullWidth?: boolean`

#### `TopNav`
Fixed top navigation bar.
- Left: logo mark + "Road Trip Planner" wordmark
- Center (desktop): nav links — Trips / Explore / (Phase 6) AI Assistant
- Right: user avatar dropdown (Profile / Sign Out)
- Mobile: hamburger → full-screen menu overlay

#### `TripCard`
Used in the dashboard grid. Displays:
- Cover image (placeholder gradient if none set, using the accent color)
- Mode badge (`Point-to-Point` or `Radius`)
- Status badge (`Draft` / `Planned` / `Completed`)
- Trip title
- Total distance + drive time in a stats row
- Last updated timestamp
- 3-dot overflow menu

#### `StatPill`
Inline stat display: icon + value + unit. Used for drive time, distance, stops.
Example: `🕐 4 h 32 min` | `📍 280 mi` | `🚏 3 stops`

#### `EmptyState`
Centered illustration + heading + subtext + optional CTA button.
Used on: empty trips list, no waypoints, no suggestions found.

#### `LoadingOverlay`
Full-component spinner with optional message. Used during route calculation and AI processing.

#### `ModeSelector`
Two large radio-card options side by side:
- **Point-to-Point** — icon of an A→B arrow, description: "Plan a route from start to finish"
- **Radius** — icon of a circle/radius, description: "Explore destinations within a drive time"
Selected card has a `primary-500` border and subtle background tint.

---

## Landing Page (`/`)

The unauthenticated home page. Visible before login. Should be the "wow" first impression.

### Sections (top to bottom)

#### Hero
- Full-width section, min-height `100vh`.
- Background: a subtle topographic map SVG pattern (neutral tones) or a high-quality road/landscape photo with a dark overlay.
- Headline (display font): **"Your next road trip, planned."**
- Subheading: **"Two planning modes. Infinite possibilities. Start from anywhere."**
- Two CTAs side by side: `Get Started` (primary button → `/register`) and `See how it works` (ghost button → scrolls to features section).
- Decorative: a small animated route line or a static map card mockup.

#### Features Section
Three feature cards in a row (stack on mobile):
1. **Point-to-Point** — icon, headline, 2-line description
2. **Radius Explorer** — icon, headline, 2-line description
3. **AI Trip Assistant** — icon, headline, 2-line description (marked "Coming soon" badge)

#### How It Works
Three-step numbered flow:
1. Enter your starting point
2. Choose stops or let us find them
3. Hit the road with a full itinerary

#### Footer
- Logo + tagline
- Links: GitHub (repo), Privacy, Terms
- "Built with Claude" credit

---

## Design Token File
Create `src/styles/tokens.css` with CSS custom properties mirroring the Tailwind tokens. This allows the map provider (Google Maps / Mapbox) to use the same colors for marker styling.

```css
:root {
  --color-primary: #3B82F6;
  --color-accent: #FBBF24;
  --color-bg: #FAFAF9;
  --color-text: #1C1917;
  --color-text-muted: #78716C;
  --color-border: #E7E5E4;
  --radius-card: 12px;
  --radius-input: 8px;
}
```

---

## Component Showcase Page (`/design`)

A dev-only route (hidden from nav, accessible at `/design`) that renders every component in all its states. Useful for agents building feature pages to see what's available.

### Sections on `/design`
1. **Colors** — swatch grid for every palette token
2. **Typography** — all heading levels + body + mono
3. **Buttons** — all variants + sizes + disabled states
4. **Form Elements** — Input, Textarea, Select, Combobox
5. **Badges** — all variants
6. **Cards** — TripCard, StatPill, ModeSelector
7. **Feedback** — Toast examples, LoadingOverlay, EmptyState, Skeleton
8. **Modals & Sheets** — Dialog, Sheet (open/close toggles)
9. **Navigation** — TopNav (full-width preview), PageShell layout

The `/design` page should have no auth requirement and be excluded from the sitemap.

---

## File Structure
```
frontend/src/
├── app/
│   ├── layout.tsx              # font setup, global styles
│   ├── page.tsx                # landing page
│   └── design/
│       └── page.tsx            # component showcase
├── components/
│   ├── ui/                     # shadcn/ui generated components
│   ├── layout/
│   │   ├── PageShell.tsx
│   │   └── TopNav.tsx
│   └── shared/
│       ├── TripCard.tsx
│       ├── StatPill.tsx
│       ├── EmptyState.tsx
│       ├── LoadingOverlay.tsx
│       └── ModeSelector.tsx
└── styles/
    ├── globals.css             # Tailwind directives + base resets
    └── tokens.css              # CSS custom properties
```

---

## Acceptance Criteria
- [ ] Landing page renders at `/` with hero, features, how-it-works, and footer sections.
- [ ] Landing page is responsive and usable at 375px, 768px, and 1280px widths.
- [ ] `/design` page renders all components listed above without console errors.
- [ ] All Tailwind custom color tokens are defined and apply correctly (visible in the `/design` color swatches).
- [ ] `Button`, `Input`, `Badge`, `Card`, `Dialog`, `Sheet`, `Toast`, and `Skeleton` are installed from shadcn/ui and customized to match the palette.
- [ ] `TripCard` renders correctly with and without a cover image.
- [ ] `ModeSelector` shows correct selected/unselected states.
- [ ] `TopNav` is responsive: desktop nav links visible on ≥768px, hamburger menu on <768px.
- [ ] `pnpm typecheck` and `pnpm lint` pass with zero errors.
- [ ] No hardcoded hex colors in component files — all colors reference Tailwind tokens.

---

## Notes for the Implementing Agent
- Run `pnpm dlx shadcn@latest init` and select the **Stone** base color to align with the neutral palette defined above.
- The `/design` page is for development reference only — add `if (process.env.NODE_ENV === 'production') notFound()` at the top of the page component to prevent it from being accessible in production builds.
- For the landing page background pattern, a lightweight SVG topographic pattern can be generated inline as a `background-image: url("data:image/svg+xml,...")` — no image asset needed.
- Do not use CSS modules or styled-components — Tailwind utility classes only.
- The `JetBrains Mono` font is only needed for coordinate/stat display; load it with `display: 'swap'` and `subset: ['latin']` to keep the bundle small.
- Keep the landing page in a single `page.tsx` file with section components defined in the same file — no need to split into separate files for this page.
