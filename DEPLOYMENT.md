# Vercel Deployment & 15-Minute Schedule Guide

## 1. Environment Variables to Set in Vercel
Copy these from `.env.local` into **Vercel Project Settings -> Environment Variables** (Production & Preview):

- `NEXT_SUPABASE_URL`
- `NEXT_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEBSITE_ID` (`68db98eb-ed4a-43e9-bcf5-9fc887a77278`)
- `ENCRYPTION_KEY` (32-byte base64 key)
- `CRON_SECRET`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `GMAIL_FROM_NAME`
- `NEXT_PUBLIC_APP_URL` (`https://ltfrb-slot-helper.vercel.app`)
- `APP_URL` (`https://ltfrb-slot-helper.vercel.app`)

## 2. Enable the 15-Minute Automatic Check

### Vercel Hobby (Free Plan) — Recommended Options
Vercel Hobby limits `vercel.json` crons to once per day, so do **not** put `*/15 * * * *` in `vercel.json`. Use one of these instead:

1. **Supabase `pg_cron` + `pg_net` (Exact, free, runs inside your existing Supabase project)**:
   - Enable `pg_cron` and `pg_net` under **Supabase -> Database -> Extensions**.
   - Run `supabase/pg_cron_setup.sql.example` in the Supabase SQL Editor with your `CRON_SECRET`.

2. **`cron-job.org` (Exact, free, zero code setup)**:
   - Create a free cron job pointing to `https://ltfrb-slot-helper.vercel.app/api/cron/check-slots`
   - Method: `POST`
   - Schedule: Every `15` minutes
   - Header: `Authorization: Bearer <your CRON_SECRET>`

3. **GitHub Actions (`.github/workflows/cron-check-slots.yml`)**:
   - Add `APP_URL` (`https://ltfrb-slot-helper.vercel.app`) and `CRON_SECRET` under **GitHub Repo -> Settings -> Secrets and variables -> Actions -> Repository secrets**.
   - Note: GitHub Actions free `schedule` jobs are best-effort and can be delayed by 15–45+ minutes during peak UTC ticks.

### Vercel Pro Plan
Copy `vercel.pro.json.example` to `vercel.json` before deploying so Vercel Cron calls `/api/cron/check-slots` every 15 minutes natively.

## 3. Post-Deploy Verification
1. Visit `https://ltfrb-slot-helper.vercel.app/api/health` and confirm `"ok": true`.
2. Sign in at `https://ltfrb-slot-helper.vercel.app/login`.
3. Pick up to **2 franchise types** to monitor for your account.
4. Create an email alert and click **Check Slots Now** to confirm live snapshot saving and Gmail SMTP delivery.
5. Check `ltfrb_cron_runs` in Supabase to confirm scheduled runs are arriving every 15 minutes.
