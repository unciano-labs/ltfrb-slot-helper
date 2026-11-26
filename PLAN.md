# LTFRB Franchise Monitor & Slot Reservation App — Implementation Plan

## 1. Goal & Stack
Build a private monitoring and automated slot-reservation web application for **`https://ltfrb-foa.ph/`**, deployed on **Vercel** and backed by **Supabase**.

- **Frontend / Backend**: Next.js (App Router, Strict TypeScript) + Tailwind CSS
- **Database & Auth**: Existing Multi-Tenant Supabase (`website_id` + per-user `user_id`, Row-Level Security)
- **Hosting & Scheduling**: Vercel (+ GitHub Actions for 15-min Hobby schedule, or `vercel.pro.json.example` for Pro)
- **Email Alerts**: Gmail SMTP via Nodemailer

---

## 2. Verified Target API Findings (`ltfrb-foa.ph`)
Inspection of `https://ltfrb-foa.ph/` shows it communicates with **`https://ws.ltfrb-foa.ph/`**:

- **Public Slot & Metadata Endpoints**
  - `GET /api/v1/public/franchise-types`
  - `GET /api/v1/regions`, `GET /api/v1/province`, `GET /api/v1/routes`
  - `GET /api/v1/regions/slot-availability`
  - `GET /api/v1/province/slot-availability`
- **Authenticated Endpoints**
  - `POST /api/v1/operator/login`, `GET /api/v1/operator/profile`
  - `POST /api/v1/tnc/login`, `GET /api/v1/tnc/profile`
  - `POST /api/v1/operator/applications` (payload mapped from `/application/new`)

---

## 3. Progress by Phase

### Phase 1: Project Setup, Database Schema & Infrastructure
- [x] **1.1 Initialize Next.js + Tailwind Project** (strict TypeScript `allowJs: false`)
- [x] **1.2 Provision & Configure Multi-Tenant Supabase** (`website_id` row created, `001` & `002` migrations applied & verified across all 8 `ltfrb_*` tables)
- [x] **1.3 Shared LTFRB API Client & Types** (`src/lib/ltfrb/client.ts` with polite headers, sequential jittered fetching, 6h metadata cache, and graceful `403/429/503` handling)

### Phase 2: Slot Monitoring Engine, 15-Minute Cron & Email Alerts
- [x] **2.1 Slot Sync & Diff Service** (`src/lib/monitor/sync-slots.ts` with snapshot caching, 7-day retention pruning, and per-account max-2 franchise filtering)
- [x] **2.2 Gmail SMTP Notification Service** (`src/lib/notifications/email.ts` with selectable triggers: slot open, slot increased, slot decreased + cooldown)
- [x] **2.3 Secured 15-Minute Cron Endpoint (`/api/cron/check-slots`)** + `.github/workflows/cron-check-slots.yml` & `vercel.pro.json.example`
- [x] **2.4 Manual Check (2-min anti-abuse cooldown) & Health Endpoint (`/api/health`)**

### Phase 3: Senior-Friendly Monitoring Dashboard UI
- [x] **3.1 Supabase Auth & Protected App Shell** (`/login` + `/api/auth/*`, header status & sign out)
- [x] **3.2 Up-to-2 Franchise Picker & Live Slots Explorer** (`FranchisePickerCard`, Region/Province toggle, Open Only filter)
- [x] **3.3 Watch Rules & Alert History** (selectable triggers, pause/resume, email logs)

### Phase 4: LTFRB Login & Automatic Slot Reservation
- [x] **4.1 `AES-256-GCM` Credential Vault & Session Manager** (`/api/ltfrb/account`)
- [x] **4.2 Mapped `POST /api/v1/operator/applications` Payload & Error Classification**
- [x] **4.3 Auto-Reserve Profile Builder UI** (`AutoReserveTab.tsx` with Region/Province/Route dropdowns & vehicle details)
- [x] **4.4 Idempotent Slot Reservation Executor** (`reservation.ts` with atomic `idle -> submitting` lock, auto token refresh, `full_slot` retry readiness, and Gmail confirmation)

### Phase 5: Testing, Verification & Deployment
- [x] **5.1 Automated Tests & UI Audit** (`npm run typecheck`, `npm test`, `npm run test:ui`, `npm run lint`, `npm run build`)
- [ ] **5.2 Production Deployment on Vercel** (follow `DEPLOYMENT.md` to push to Vercel + configure production env vars & 15-minute trigger)
