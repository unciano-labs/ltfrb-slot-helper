import { NextRequest, NextResponse } from "next/server";
import { getWebsiteId } from "@/lib/env";
import { ensureProjectUserRecord } from "@/lib/monitor/entitlements";
import {
  checkAndRecordRegistrationRateLimit,
  extractClientIp,
  validateAndNormalizeRegistrationInput,
} from "@/lib/security/registration";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ip = extractClientIp(request);
  const rawEmail = String(body?.email ?? "");

  const rateLimit = await checkAndRecordRegistrationRateLimit({
    ip,
    email: rawEmail,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: rateLimit.message || "Too many account creation attempts. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const parsed = validateAndNormalizeRegistrationInput(body);
  if (!parsed.valid) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { firstName, lastName, fullName, mobile, email, password } = parsed.data;
  const websiteId = getWebsiteId();
  const supabase = await createSupabaseAuthServerClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        website_id: websiteId,
        registered_project: "ltfrb-slot-helper",
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        mobile,
      },
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (data.user?.id) {
    await ensureProjectUserRecord(data.user.id, data.user.email ?? email, {
      firstName,
      lastName,
      mobile,
    });
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
