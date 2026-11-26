import { NextRequest, NextResponse } from "next/server";
import { ensureProjectUserRecord } from "@/lib/monitor/entitlements";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "");

  if (!email || !password) {
    return NextResponse.json(
      { error: "Please enter both your email address and password." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseAuthServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.message ?? "Invalid email or password. Please try again." },
      { status: 401 }
    );
  }

  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  await ensureProjectUserRecord(data.user.id, data.user.email ?? email, {
    firstName: typeof meta.first_name === "string" ? meta.first_name : null,
    lastName: typeof meta.last_name === "string" ? meta.last_name : null,
    mobile: typeof meta.mobile === "string" ? meta.mobile : null,
  });

  return NextResponse.json({
    ok: true,
    user: { id: data.user.id, email: data.user.email ?? email },
  });
}
