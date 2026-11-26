import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { assertUserCanManageAutomation } from "@/lib/monitor/entitlements";
import { isFranchiseAllowedForAccount } from "@/lib/monitor/preferences";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ rules: [], supabaseConfigured: false });
  }

  const { supabase, websiteId } = getTenantContext();
  const { data, error } = await supabase
    .from("ltfrb_watch_rules")
    .select("*")
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rules: data ?? [], supabaseConfigured: true });
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured yet." },
      { status: 400 }
    );
  }

  const gate = await assertUserCanManageAutomation(user.id, user.email);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  if (gate.entitlements.usedAlerts >= gate.entitlements.maxAlertSlots) {
    return NextResponse.json(
      {
        error: `You have reached your limit of ${gate.entitlements.maxAlertSlots} alert slot(s). Add an extra alert slot (+₱100) under Plan & Billing to monitor more slots.`,
      },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const scope = body.scope === "province" ? "province" : "region";
  const franchiseTypeCode = String(body.franchise_type_code ?? "").trim();
  const franchiseTypeName = String(body.franchise_type_name ?? "").trim();
  const notifyEmail = String(body.notify_email ?? "").trim();
  const label = String(body.label ?? "").trim();

  if (!franchiseTypeCode || !franchiseTypeName || !notifyEmail || !label) {
    return NextResponse.json(
      { error: "Please fill in the alert name, franchise type, and email address." },
      { status: 400 }
    );
  }

  const minRemaining = Math.max(1, Number(body.min_remaining ?? 1) || 1);
  const cooldownMinutes = Math.max(0, Number(body.cooldown_minutes ?? 60) || 60);
  const notifyWhenAvailable = body.notify_when_available !== false;
  const notifyWhenIncreased = body.notify_when_increased !== false;
  const notifyWhenDecreased = Boolean(body.notify_when_decreased);

  if (!notifyWhenAvailable && !notifyWhenIncreased && !notifyWhenDecreased) {
    return NextResponse.json(
      { error: "Please pick at least one reason to send you an email alert." },
      { status: 400 }
    );
  }

  const { supabase, websiteId } = getTenantContext();

  const { data: prefRow } = await supabase
    .from("ltfrb_user_preferences")
    .select("monitored_franchise_codes")
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .maybeSingle();

  const monitoredCodes =
    (prefRow?.monitored_franchise_codes as string[] | undefined) ?? [];

  if (!isFranchiseAllowedForAccount(franchiseTypeCode, monitoredCodes, gate.entitlements.maxAlertSlots)) {
    return NextResponse.json(
      {
        error:
          monitoredCodes.length === 0
            ? "Please choose your 1 or 2 monitored franchise types first before saving an email alert."
            : `You can only create alerts for your selected franchises (${monitoredCodes.join(", ")}). Update your monitored franchises first if you want to switch.`,
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("ltfrb_watch_rules")
    .insert({
      website_id: websiteId,
      user_id: user.id,
      label,
      scope,
      franchise_type_code: franchiseTypeCode,
      franchise_type_name: franchiseTypeName,
      region_code: body.region_code ? String(body.region_code) : null,
      region_name: body.region_name ? String(body.region_name) : null,
      province_code: body.province_code ? String(body.province_code) : null,
      province_name: body.province_name ? String(body.province_name) : null,
      min_remaining: minRemaining,
      notify_email: notifyEmail,
      cooldown_minutes: cooldownMinutes,
      notify_when_available: notifyWhenAvailable,
      notify_when_increased: notifyWhenIncreased,
      notify_when_decreased: notifyWhenDecreased,
      is_active: true,
      auto_submit: Boolean(body.auto_submit),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured yet." },
      { status: 400 }
    );
  }

  const gate = await assertUserCanManageAutomation(user.id, user.email);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body?.id ? String(body.id) : "";
  if (!id) {
    return NextResponse.json({ error: "Missing watch rule id." }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body?.is_active === "boolean") updates.is_active = body.is_active;
  if (typeof body?.auto_submit === "boolean") updates.auto_submit = body.auto_submit;
  if (typeof body?.notify_when_available === "boolean")
    updates.notify_when_available = body.notify_when_available;
  if (typeof body?.notify_when_increased === "boolean")
    updates.notify_when_increased = body.notify_when_increased;
  if (typeof body?.notify_when_decreased === "boolean")
    updates.notify_when_decreased = body.notify_when_decreased;

  const { supabase, websiteId } = getTenantContext();
  const { data, error } = await supabase
    .from("ltfrb_watch_rules")
    .update(updates)
    .eq("id", id)
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured yet." },
      { status: 400 }
    );
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing watch rule id." }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();
  const { error } = await supabase
    .from("ltfrb_watch_rules")
    .delete()
    .eq("id", id)
    .eq("website_id", websiteId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
