import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createSupabaseAuthServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
