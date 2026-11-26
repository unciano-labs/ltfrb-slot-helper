import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fetchFranchiseTypes } from "@/lib/ltfrb/client";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseConfigured = isSupabaseConfigured();
  let ltfrbOk = false;
  let supabaseOk = false;
  let ltfrbError: string | null = null;
  let supabaseError: string | null = null;

  try {
    const types = await fetchFranchiseTypes();
    ltfrbOk = types.length > 0;
  } catch (err) {
    ltfrbError = err instanceof Error ? err.message : "Failed to reach LTFRB API";
  }

  if (supabaseConfigured) {
    try {
      const { supabase, websiteId } = getTenantContext();
      const { error } = await supabase
        .from("ltfrb_cron_runs")
        .select("id", { count: "exact", head: true })
        .eq("website_id", websiteId);
      if (error) {
        supabaseError = error.message;
      } else {
        supabaseOk = true;
      }
    } catch (err) {
      supabaseError = err instanceof Error ? err.message : "Supabase check failed";
    }
  }

  return NextResponse.json({
    ok: ltfrbOk && (!supabaseConfigured || supabaseOk),
    ltfrb: { ok: ltfrbOk, error: ltfrbError },
    supabase: { configured: supabaseConfigured, ok: supabaseOk, error: supabaseError },
    checkedAt: new Date().toISOString(),
  });
}
