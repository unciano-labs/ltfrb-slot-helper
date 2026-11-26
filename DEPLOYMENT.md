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
- `NEXT_PUBLIC_APP_URL` (your deployed `https://...vercel.app` URL)
- `APP_URL` (same deployed URL)

## 2. Enable the 15-Minute Automatic Check

### Option A — Vercel Hobby (Free Plan, Recommended via GitHub Actions)
Vercel Hobby limits native `vercel.json` crons to once per day. Instead, use the included workflow at `.github/workflows/cron-check-slots.yml`:
1. Push this project to a GitHub repository.
2. In **GitHub Repo Settings -> Secrets and variables -> Actions**, add:
   - `APP_URL` = `https://your-app.vercel.app`
   - `CRON_SECRET` = same value as `CRON_SECRET` in Vercel
3. GitHub Actions will call `POST /api/cron/check-slots` every 15 minutes (`*/15 * * * *`).

### Option B — Vercel Pro Plan
Copy `vercel.pro.json.example` to `vercel.json` before deploying so Vercel Cron calls `/api/cron/check-slots` every 15 minutes natively.

## 3. Post-Deploy Verification
1. Visit `https://your-app.vercel.app/api/health` and confirm `"ok": true`.
2. Sign in at `https://your-app.vercel.app/login`.
3. Pick up to **2 franchise types** to monitor for your account.
4. Create an email alert and click **Check Slots Now** to confirm live snapshot saving and Gmail SMTP delivery.
5. Trigger the GitHub Actions workflow manually once (**Actions -> LTFRB 15-Minute Slot Check -> Run workflow**) to verify the `CRON_SECRET` end-to-end.
