import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { normalizeSubmissionLogRow } from "@/lib/monitor/submission-trigger";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type LogCategoryParam = "checks" | "emails" | "submissions" | "movements";

const VALID_CATEGORIES = new Set<LogCategoryParam>([
  "checks",
  "emails",
  "submissions",
  "movements",
]);

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ items: [], hasMore: false });
  }

  const categoryRaw = request.nextUrl.searchParams.get("category") ?? "";
  if (!VALID_CATEGORIES.has(categoryRaw as LogCategoryParam)) {
    return NextResponse.json({ error: "Invalid log category." }, { status: 400 });
  }
  const category = categoryRaw as LogCategoryParam;

  const offset = clampInt(request.nextUrl.searchParams.get("offset"), 0, 0, 50_000);
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 40, 1, 200);
  const rangeEnd = offset + limit; // fetch limit + 1 to detect hasMore without count(*)

  const { supabase, websiteId } = getTenantContext();

  if (category === "checks") {
    const { data, error } = await supabase
      .from("ltfrb_cron_runs")
      .select("*")
      .eq("website_id", websiteId)
      .order("started_at", { ascending: false })
      .range(offset, rangeEnd);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = data ?? [];
    return NextResponse.json({
      items: rows.slice(0, limit),
      hasMore: rows.length > limit,
    });
  }

  if (category === "emails") {
    const { data, error } = await supabase
      .from("ltfrb_notification_logs")
      .select("id, slot_key, recipient, subject, remaining_at_alert, status, sent_at")
      .eq("website_id", websiteId)
      .eq("user_id", user.id)
      .order("sent_at", { ascending: false })
      .range(offset, rangeEnd);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = data ?? [];
    return NextResponse.json({
      items: rows.slice(0, limit),
      hasMore: rows.length > limit,
    });
  }

  if (category === "submissions") {
    const { data, error } = await supabase
      .from("ltfrb_submission_logs")
      .select("*")
      .eq("website_id", websiteId)
      .eq("user_id", user.id)
      .order("attempted_at", { ascending: false })
      .range(offset, rangeEnd);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = (data as Array<Record<string, unknown>> | null) ?? [];
    return NextResponse.json({
      items: rows.slice(0, limit).map(normalizeSubmissionLogRow),
      hasMore: rows.length > limit,
    });
  }

  // category === "movements"
  const { data, error } = await supabase
    .from("ltfrb_slot_events")
    .select("*")
    .eq("website_id", websiteId)
    .order("occurred_at", { ascending: false })
    .range(offset, rangeEnd);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ items: [], hasMore: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  return NextResponse.json({
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
  });
}
