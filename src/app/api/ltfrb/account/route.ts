import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { authenticateLtfrbAccount } from "@/lib/ltfrb/client";
import { encryptSecret } from "@/lib/security/crypto";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ account: null, authenticated: false });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ account: null, authenticated: true, supabaseConfigured: false });
  }

  const { supabase, websiteId } = getTenantContext();
  const { data, error } = await supabase
    .from("ltfrb_accounts")
    .select("id, account_type, ltfrb_email, last_verified_at, updated_at")
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    account: data ?? null,
    authenticated: true,
    supabaseConfigured: true,
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Please sign in to your account before saving LTFRB credentials." },
      { status: 401 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured yet." },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = String(body?.email ?? "").trim();
  const password = String(body?.password ?? "");
  const accountType = body?.accountType === "tnc" ? "tnc" : "operator";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Please enter both your LTFRB email and password." },
      { status: 400 }
    );
  }

  const authResult = await authenticateLtfrbAccount({
    accountType,
    email,
    password,
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message ?? "Could not sign in to LTFRB with those details." },
      { status: 401 }
    );
  }

  let encryptedPassword: string;
  let encryptedToken: string | null = null;
  try {
    encryptedPassword = encryptSecret(password);
    if (authResult.token) {
      encryptedToken = encryptSecret(authResult.token);
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Encryption key is missing on the server.",
      },
      { status: 500 }
    );
  }

  const now = new Date().toISOString();
  const { supabase, websiteId } = getTenantContext();
  const { data, error } = await supabase
    .from("ltfrb_accounts")
    .upsert(
      {
        website_id: websiteId,
        user_id: user.id,
        account_type: accountType,
        ltfrb_email: email,
        encrypted_password: encryptedPassword,
        encrypted_token: encryptedToken,
        last_verified_at: now,
        updated_at: now,
      },
      { onConflict: "website_id,user_id,account_type,ltfrb_email" }
    )
    .select("id, account_type, ltfrb_email, last_verified_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "Your LTFRB account signed in successfully and is saved securely.",
    account: data,
  });
}
