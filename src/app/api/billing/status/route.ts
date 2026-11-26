import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { loadUserBillingState } from "@/lib/monitor/entitlements";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const state = await loadUserBillingState(user.id, user.email);
  return NextResponse.json(state);
}
