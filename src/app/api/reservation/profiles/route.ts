import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { hasValidOwnershipDocument } from "@/lib/ltfrb/client";
import type { VehicleUnitInput } from "@/lib/ltfrb/types";
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
    return NextResponse.json({ profiles: [], logs: [] });
  }

  const { supabase, websiteId } = getTenantContext();
  const [profilesRes, logsRes] = await Promise.all([
    supabase
      .from("ltfrb_application_profiles")
      .select("*")
      .eq("website_id", websiteId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("ltfrb_submission_logs")
      .select("*")
      .eq("website_id", websiteId)
      .eq("user_id", user.id)
      .order("attempted_at", { ascending: false })
      .limit(20),
  ]);

  if (profilesRes.error) {
    return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    profiles: profilesRes.data ?? [],
    logs: logsRes.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const profileName = String(body.profile_name ?? "").trim();
  const franchiseTypeCode = String(body.franchise_type_code ?? "").trim();
  const regionId = String(body.region_id ?? "").trim();
  const regionName = String(body.region_name ?? "").trim();

  if (!profileName || !franchiseTypeCode || !regionId || !regionName) {
    return NextResponse.json(
      { error: "Please enter a profile name, franchise type, and region." },
      { status: 400 }
    );
  }

  const units = Array.isArray(body.units) ? (body.units as VehicleUnitInput[]) : [];
  if (units.length === 0) {
    return NextResponse.json(
      { error: "Please fill in at least one vehicle unit (plate number, make, year)." },
      { status: 400 }
    );
  }

  if (!units[0]?.body_type?.trim()) {
    return NextResponse.json(
      { error: "Please enter the vehicle Body Type (for example: Sedan, MPV, SUV, or Van)." },
      { status: 400 }
    );
  }

  const requiresEvType = franchiseTypeCode === "E_TNVS" || franchiseTypeCode === "EVT";
  const evType = units[0]?.ev_type;
  if (requiresEvType && (!evType || !["BEV", "PHEV", "HEV"].includes(evType))) {
    return NextResponse.json(
      {
        error: `Please pick an Electric Vehicle Type (BEV, PHEV, or HEV) for ${franchiseTypeCode}.`,
      },
      { status: 400 }
    );
  }

  const wantsArmed = Boolean(body.is_armed);
  const submitOnIncrease = body.submit_on_slot_increase !== false;
  const submitAtMidnight = Boolean(body.submit_at_midnight);
  const submitHourly = Boolean(body.submit_hourly);

  if (wantsArmed && !submitOnIncrease && !submitAtMidnight && !submitHourly) {
    return NextResponse.json(
      {
        error:
          "Please pick at least one auto-submit timing (when slots increase, at 12:00 MN / 7:00 AM / 8:00 AM, or once every hour).",
      },
      { status: 400 }
    );
  }

  if (wantsArmed && !hasValidOwnershipDocument(units[0]?.documents)) {
    return NextResponse.json(
      {
        error:
          "Please upload your Sales Invoice PDF (or both OR and CR PDFs) before turning on Automatic Slot Reservation.",
      },
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

  if (!isFranchiseAllowedForAccount(franchiseTypeCode, monitoredCodes)) {
    return NextResponse.json(
      {
        error:
          monitoredCodes.length === 0
            ? "Please choose your 1 or 2 monitored franchise types first before saving a reservation profile."
            : `You can only reserve slots for your selected franchises (${monitoredCodes.join(", ")}).`,
      },
      { status: 400 }
    );
  }

  // Link to the user's latest saved LTFRB account if available
  const { data: acct } = await supabase
    .from("ltfrb_accounts")
    .select("id")
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("ltfrb_application_profiles")
    .insert({
      website_id: websiteId,
      user_id: user.id,
      account_id: acct?.id ?? null,
      watch_rule_id: body.watch_rule_id ? String(body.watch_rule_id) : null,
      profile_name: profileName,
      franchise_type_code: franchiseTypeCode,
      region_id: regionId,
      region_name: regionName,
      province_id: body.province_id ? String(body.province_id) : null,
      province_name: body.province_name ? String(body.province_name) : null,
      route_id: body.route_id ? String(body.route_id) : null,
      route_name: body.route_name ? String(body.route_name) : null,
      number_of_units: Math.max(1, Number(body.number_of_units ?? units.length) || 1),
      is_fleet: Boolean(body.is_fleet),
      units,
      notify_email: body.notify_email ? String(body.notify_email).trim() : user.email ?? null,
      is_armed: Boolean(body.is_armed),
      submit_on_slot_increase: submitOnIncrease,
      submit_at_midnight: submitAtMidnight,
      submit_hourly: submitHourly,
      lock_status: "idle",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = body?.id ? String(body.id) : "";
  if (!id) {
    return NextResponse.json({ error: "Missing reservation profile id." }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();

  const { data: existing, error: existingErr } = await supabase
    .from("ltfrb_application_profiles")
    .select("*")
    .eq("id", id)
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Reservation profile not found." }, { status: 404 });
  }
  if (existing.lock_status === "submitted") {
    return NextResponse.json(
      { error: "This application is already submitted and cannot be edited." },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body?.profile_name === "string" && body.profile_name.trim()) {
    updates.profile_name = body.profile_name.trim();
  }
  if (typeof body?.franchise_type_code === "string" && body.franchise_type_code.trim()) {
    const nextCode = body.franchise_type_code.trim();
    const { data: prefRow } = await supabase
      .from("ltfrb_user_preferences")
      .select("monitored_franchise_codes")
      .eq("website_id", websiteId)
      .eq("user_id", user.id)
      .maybeSingle();
    const monitoredCodes =
      (prefRow?.monitored_franchise_codes as string[] | undefined) ?? [];
    if (!isFranchiseAllowedForAccount(nextCode, monitoredCodes)) {
      return NextResponse.json(
        {
          error: `You can only monitor your selected franchises (${monitoredCodes.join(", ")}).`,
        },
        { status: 400 }
      );
    }
    updates.franchise_type_code = nextCode;
  }
  if (typeof body?.region_id === "string" && body.region_id.trim()) {
    updates.region_id = body.region_id.trim();
  }
  if (typeof body?.region_name === "string" && body.region_name.trim()) {
    updates.region_name = body.region_name.trim();
  }
  if (body && "province_id" in body) {
    updates.province_id = body.province_id ? String(body.province_id) : null;
  }
  if (body && "province_name" in body) {
    updates.province_name = body.province_name ? String(body.province_name) : null;
  }
  if (body && "route_id" in body) {
    updates.route_id = body.route_id ? String(body.route_id) : null;
  }
  if (body && "route_name" in body) {
    updates.route_name = body.route_name ? String(body.route_name) : null;
  }
  if (body && "notify_email" in body) {
    updates.notify_email = body.notify_email ? String(body.notify_email).trim() : null;
  }
  if (typeof body?.is_armed === "boolean") updates.is_armed = body.is_armed;
  if (typeof body?.submit_on_slot_increase === "boolean")
    updates.submit_on_slot_increase = body.submit_on_slot_increase;
  if (typeof body?.submit_at_midnight === "boolean")
    updates.submit_at_midnight = body.submit_at_midnight;
  if (typeof body?.submit_hourly === "boolean")
    updates.submit_hourly = body.submit_hourly;
  if (Array.isArray(body?.units)) updates.units = body.units as VehicleUnitInput[];

  const effectiveFranchiseCode = String(
    updates.franchise_type_code ?? existing.franchise_type_code
  );
  const effectiveUnits = (updates.units ?? existing.units) as VehicleUnitInput[];
  const effectiveArmed =
    typeof updates.is_armed === "boolean" ? updates.is_armed : Boolean(existing.is_armed);
  const effectiveOnIncrease =
    typeof updates.submit_on_slot_increase === "boolean"
      ? updates.submit_on_slot_increase
      : Boolean(existing.submit_on_slot_increase ?? true);
  const effectiveAtMidnight =
    typeof updates.submit_at_midnight === "boolean"
      ? updates.submit_at_midnight
      : Boolean(existing.submit_at_midnight);
  const effectiveHourly =
    typeof updates.submit_hourly === "boolean"
      ? updates.submit_hourly
      : Boolean(existing.submit_hourly);

  if (!effectiveUnits[0]?.body_type?.trim()) {
    return NextResponse.json(
      { error: "Please enter the vehicle Body Type (for example: Sedan, MPV, SUV, or Van)." },
      { status: 400 }
    );
  }

  const requiresEvType =
    effectiveFranchiseCode === "E_TNVS" || effectiveFranchiseCode === "EVT";
  const evType = effectiveUnits[0]?.ev_type;
  if (requiresEvType && (!evType || !["BEV", "PHEV", "HEV"].includes(evType))) {
    return NextResponse.json(
      {
        error: `Please pick an Electric Vehicle Type (BEV, PHEV, or HEV) for ${effectiveFranchiseCode}.`,
      },
      { status: 400 }
    );
  }

  if (effectiveArmed && !effectiveOnIncrease && !effectiveAtMidnight && !effectiveHourly) {
    return NextResponse.json(
      {
        error:
          "Please pick at least one auto-submit timing (when slots increase, at 12:00 MN / 7:00 AM / 8:00 AM, or once every hour).",
      },
      { status: 400 }
    );
  }

  if (effectiveArmed && !hasValidOwnershipDocument(effectiveUnits[0]?.documents)) {
    return NextResponse.json(
      {
        error:
          "Please upload your Sales Invoice PDF (or both OR and CR PDFs) before turning on Auto-Reserve.",
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("ltfrb_application_profiles")
    .update(updates)
    .eq("id", id)
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing reservation profile id." }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();
  const { error } = await supabase
    .from("ltfrb_application_profiles")
    .delete()
    .eq("id", id)
    .eq("website_id", websiteId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
