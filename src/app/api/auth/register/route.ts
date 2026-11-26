import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "");

  if (!email || password.length < 6) {
    return NextResponse.json(
      { error: "Please enter a valid email and a password of at least 6 characters." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseAuthServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data.session) {
    return NextResponse.json({
      ok: true,
      needsEmailConfirmation: true,
      message:
        "Account created. Please check your email inbox and click the confirmation link before signing in.",
    });
  }

  return NextResponse.json({
    ok: true,
    needsEmailConfirmation: false,
    user: { id: data.user?.id, email: data.user?.email ?? email },
  });
}
