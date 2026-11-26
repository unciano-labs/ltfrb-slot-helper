# LTFRB Franchise Monitor & Slot Reservation Helper

A private Next.js + Tailwind CSS web application that monitors franchise slot availability on **`https://ltfrb-foa.ph/`** every 15 minutes, sends Gmail SMTP alerts when slots open or change, and safely submits pre-filled LTFRB applications when slots become available.

Designed specifically for **non-technical senior adults** with large readable typography (`18px+`), plain self-explanatory English, `48px+` buttons/inputs, and flat high-contrast surfaces with zero gradients or decorative borders.

---

## Tech Stack

- **Framework**: Next.js (App Router, strict TypeScript) + Tailwind CSS
- **Database & Auth**: Supabase (multi-tenant `website_id` + per-user `user_id`, Row-Level Security)
- **Email Alerts**: Gmail SMTP via Nodemailer
- **Hosting & Scheduling**: Vercel (+ GitHub Actions 15-minute cron on Hobby, or Vercel Cron on Pro)

---

## Core Features

1. **Live Slot Explorer (Public)**
   - Browse real-time regional and provincial franchise slot availability (`https://ws.ltfrb-foa.ph/`).
   - Filter by Region/Province, Franchise Type, and **Open Slots Only**.
   - Dashboard loads serve cached Supabase snapshots (under 5 minutes old) to avoid unnecessary upstream requests.

2. **Per-Account Franchise Limit (Up to 2 Franchises)**
   - Signed-in users choose **1 or 2 franchise types** to monitor for their account (`ltfrb_user_preferences`).
   - Slot views, email alerts, and auto-reservations are strictly scoped to those selected franchises.

3. **Customizable 15-Minute Email Alerts**
   - Choose when Gmail alerts are sent per watch rule:
     - When a slot is available (`remaining >= 1`)
     - When open slots **increase** (new slot opened and ready to apply — bypasses cooldown)
     - When open slots **decrease**
   - Deduplication & configurable reminder cooldowns via `ltfrb_notification_logs`.

4. **Encrypted LTFRB Account Vault & PDF Uploads**
   - LTFRB Operator/TNC credentials and session tokens are encrypted server-side with `AES-256-GCM` (`ltfrb_accounts`).
   - Automatic token refresh on `HTTP 401`.
   - Direct PDF upload (`<= 5 MB`) to LTFRB for **Sales Invoice** now, with **OR** and **CR** attachable later onto saved profiles.

5. **Safe Automatic Slot Reservation**
   - Pre-fill vehicle details (`plate_number`, `mv_file_number`, `make`, `series`, `year_model`, `body_type`, `ev_type`, `engine_number`, `chassis_number`) and documents.
   - Choose when auto-submission runs:
     - **When open slots increase** (recommended)
     - **At 12:00 Midnight (Manila Time, `12:00 AM – 12:29 AM PHT`)**
     - **Once every hour** (only runs when `remaining > 0`)
   - **Safety & Idempotency Guards**:
     - Atomic database lock (`idle -> submitting -> submitted`) prevents duplicate concurrent submissions.
     - Automatically stops permanently once an application succeeds.
     - Automatically pauses (`is_armed = false`, `submit_hourly = false`) on `HTTP 403`, `409`, or `429`.
     - Emails you LTFRB's exact return message on every submission attempt.

---

## Local Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` and fill in your credentials:
```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `NEXT_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEBSITE_ID` (tenant UUID from `public.websites.id`)
- `ENCRYPTION_KEY` (32-byte base64 secret, e.g. `openssl rand -base64 32`)
- `CRON_SECRET`
- `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM_NAME`
- `NEXT_PUBLIC_APP_URL` / `APP_URL`

### 3. Run Supabase Migrations
Execute these SQL files in order inside your Supabase SQL Editor:
1. [`supabase/migrations/001_ltfrb_monitor_schema.sql`](supabase/migrations/001_ltfrb_monitor_schema.sql)
2. [`supabase/migrations/002_notification_triggers.sql`](supabase/migrations/002_notification_triggers.sql)
3. [`supabase/migrations/003_auto_submit_schedule.sql`](supabase/migrations/003_auto_submit_schedule.sql)

### 4. Start Development Server
```bash
npm run dev
```
Open `http://localhost:3000`.

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production bundle |
| `npm run start` | Start production server |
| `npm run typecheck` | Run strict TypeScript check (`tsc --noEmit`) |
| `npm test` | Run unit & integration tests (`tsx --test`) |
| `npm run test:ui` | Run static UI/UX & senior-accessibility audit |
| `npm run lint` | Run ESLint |

---

## API Routes Overview

- `GET /api/health` — Checks LTFRB API & Supabase connectivity
- `GET /api/slots` — Returns cached/live LTFRB slots and authenticated user data
- `POST /api/slots/check` — Manual check (2-minute cooldown enforced)
- `GET / POST /api/cron/check-slots` — Secured 15-minute cron handler (`Authorization: Bearer <CRON_SECRET>`)
- `POST /api/auth/login`, `/register`, `/logout`, `GET /api/auth/me` — Supabase Auth SSR session endpoints
- `GET / PUT /api/preferences` — Up-to-2 monitored franchise selection per user
- `GET / POST / PATCH / DELETE /api/watch-rules` — Email alert rules
- `GET / POST /api/ltfrb/account` — Encrypted LTFRB login verification & storage
- `GET /api/ltfrb/options` — LTFRB regions, provinces, and routes lookup
- `POST /api/ltfrb/upload` — PDF upload proxy to LTFRB (`<= 5 MB`)
- `GET / POST / PATCH / DELETE /api/reservation/profiles` — Pre-filled reservation profiles
- `POST /api/reservation/submit` — One-click manual reservation trigger

---

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for Vercel environment configuration and 15-minute scheduling options (GitHub Actions for Vercel Hobby via `.github/workflows/cron-check-slots.yml`, or native Vercel Cron via `vercel.pro.json.example` on Vercel Pro).
