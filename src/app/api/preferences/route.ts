import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { assertUserCanManageAutomation } from "@/lib/monitor/entitlements";
import { normalizeSelectedFranchises } from "@/lib/monitor/preferences";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ monitoredFranchiseCodes: [], authenticated: false });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ monitoredFranchiseCodes: [], authenticated: true });
  }

  const { supabase, websiteId } = getTenantContext();
  const { data, error } = await supabase
    .from("ltfrb_user_preferences")
    .select("monitored_franchise_codes")
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    authenticated: true,
    monitoredFranchiseCodes: (data?.monitored_franchise_codes as string[] | undefined) ?? [],
  });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const gate = await assertUserCanManageAutomation(user.id, user.email);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = normalizeSelectedFranchises(
    body?.monitoredFranchiseCodes,
    gate.entitlements.maxAlertSlots
  );

  if (!parsed.valid) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("ltfrb_user_preferences")
    .upsert(
      {
        website_id: websiteId,
        user_id: user.id,
        monitored_franchise_codes: parsed.codes,
        updated_at: now,
      },
      { onConflict: "website_id,user_id" }
    )
    .select("monitored_franchise_codes")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    monitoredFranchiseCodes: (data?.monitored_franchise_codes as string[]) ?? parsed.codes,
  });
}
