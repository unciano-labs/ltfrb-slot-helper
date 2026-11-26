---
name: ltfrb-franchise-monitor
description: >-
  Project conventions, LTFRB API architecture, and senior-friendly UI/UX rules
  for ltfrb-franchise-monitor. Use whenever building pages, components, emails,
  API routes, or database features in this Next.js + Tailwind + Supabase + Vercel
  project.
---

# LTFRB Franchise Monitor Skill

This skill governs all UI, UX, and technical implementation work in `ltfrb-franchise-monitor`.
Read [PLAN.md](../../../PLAN.md) for the phased roadmap and database schema.

---

## 1. Target User & UI/UX Non-Negotiables

The primary users are **non-technical senior adults** who need a calm, obvious, stress-free tool to monitor LTFRB franchise slots and submit an application.

### Visual Style: Zero "AI Slop", Zero Gradients, Zero Borders
- **No gradients anywhere**: Never use `bg-gradient-*`, gradient text, gradient buttons, or glowing backdrops. Use solid, flat, high-contrast colors only.
- **No borders on layouts, cards, or tables**: Do not wrap cards, panels, sections, alerts, or table rows in `border` / `border-*` classes or decorative outlines. Separate sections using **generous whitespace** and **subtle solid background steps**:
  - Page canvas: warm off-white (`#F6F5F1`)
  - Content blocks / cards: solid white (`#FFFFFF`) with comfortable padding (`p-6` to `p-8`), **no border**, and at most a very light flat/soft elevation or pure tonal contrast.
  - Form inputs: use a solid tinted surface (`#EEF1F4`) with clear focus ring (`focus:ring-4 focus:ring-blue-700/30 focus:bg-white`) rather than thin outlines.
- **No decorative AI-dashboard clutter**: No sparklines, no floating badges, no 4-card KPI rows, no dark-mode neon themes, no glassmorphism, no unnecessary icons, and no animations that distract.

### Typography & Contrast (Senior-Readable)
- **Body text**: Minimum `18px` (`text-lg`) with `leading-relaxed` (`1.6+`). Never use `text-xs` or `text-sm` for information users need to read.
- **Labels, table cells, & helper hints**: Minimum `16px–18px` (`text-base` to `text-lg`).
- **Headings**: `28px–36px` (`text-3xl` to `text-4xl`), clear hierarchy, solid near-black (`#17191C`) on light backgrounds (`>= 7:1` contrast where possible).
- **Readable line width**: Constrain prose and forms (`max-w-3xl` to `max-w-4xl`) so eyes do not scan across wide monitors.

### Simplicity, Clarity & Touch/Click Comfort
- **One primary job per screen/section**: Avoid packing settings, logs, filters, and forms into one crowded screen.
- **Plain, everyday English (zero tech jargon)**:
  - Say **"Automatic Check Every 15 Minutes"**, not "Cron Job".
  - Say **"Last Checked: Nov 26, 11:45 PM"**, not "Last Sync Timestamp".
  - Say **"Slots Left"**, not "Remaining Delta / Payload".
  - Say **"Send Me an Email When Slots Open"**, not "Configure Alert Rule Threshold".
- **Self-explanatory controls**:
  - Never use icon-only buttons. Every button must have clear text (`Check Slots Now`, `Save Alert Settings`, `Reserve My Slot`).
  - Always place permanent visible labels **above** form fields (never rely on placeholder text as a label), with a plain one-sentence hint underneath.
- **Large click targets**: Minimum `48px` height (`min-h-12 px-6 py-3`) on every button, input, select, and toggle, with generous spacing (`gap-4` / `gap-6`) between neighboring controls so users do not misclick.
- **Unmistakable feedback**:
  - Status pills use solid high-contrast fills (e.g., solid soft green `#DCFCE7` + dark green text `#14532D` for **Slots Open**, solid soft stone `#E7E5E4` + dark text `#292524` for **Full — No Slots**).
  - Error and success banners explain **what happened** and **what to do next** in one or two plain sentences.

---

## 2. Technical Architecture & Conventions

- **Stack**: Next.js (App Router, **strict TypeScript only** — `.ts` / `.tsx`, `strict: true`, `allowJs: false`, no `any`), Tailwind CSS, Supabase (PostgreSQL, Auth, Storage), Vercel.
- **Strict TypeScript Rule**: All application code, API routes, utilities, tests, and helper scripts must be written in TypeScript (`.ts` / `.tsx`). Never add `.js` or `.jsx` files under `src/`. Run `npm run typecheck` (`tsc --noEmit`) before finishing changes.
- **Upstream LTFRB API Base**: `https://ws.ltfrb-foa.ph/`
  - Public endpoints:
    - `GET /api/v1/public/franchise-types`
    - `GET /api/v1/regions`
    - `GET /api/v1/province`
    - `GET /api/v1/regions/slot-availability`
    - `GET /api/v1/province/slot-availability`
  - Auth endpoints:
    - `POST /api/v1/operator/login`, `GET /api/v1/operator/profile`
    - `POST /api/v1/tnc/login`, `GET /api/v1/tnc/profile`
- **Security Rules**:
  - Never expose `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `CRON_SECRET`, or LTFRB passwords to client components.
  - Encrypt stored LTFRB credentials/tokens with `AES-256-GCM` server-side before saving to `ltfrb_accounts`.
  - Enforce atomic locking (`idle -> submitting -> submitted`) before any reservation submission so concurrent 15-minute cron runs never double-submit.

---

## 3. Verification Checklist Before Finishing Any UI Task

Before completing any frontend component or page, verify every item:
1. Search modified files for `gradient`, `border`, `text-xs`, and `text-sm` — remove all gradients and decorative borders, and ensure readable text is at least `text-base` (`16px`) / `text-lg` (`18px`).
2. Confirm every button and form control is at least `48px` tall (`min-h-12`) with clear text labels and generous spacing.
3. Read every label, heading, and error message as if you are a 65-year-old using the app for the first time — rewrite any technical jargon into plain English.
4. Run the `ui-ux-tester` skill audit (`npm run test:ui`) and check mobile (`375px`), tablet (`768px`), and desktop (`1024px+`) responsiveness.
5. Run `npm run typecheck`, `npm run lint`, and `npm run build` (or relevant test commands) after edits.
