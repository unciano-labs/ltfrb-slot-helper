import { NextRequest, NextResponse } from "next/server";
import { isSuperAdminEmail } from "@/lib/monitor/monetization";
import {
  createSuperAdminSessionToken,
  SUPERADMIN_COOKIE_NAME,
  verifySuperAdminPassword,
} from "@/lib/security/superadmin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSuperAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "Access denied. Only the SuperAdmin account is permitted." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const password = String(body?.password ?? "");
  if (!password) {
    return NextResponse.json(
      { error: "Please enter your password to unlock SuperAdmin." },
      { status: 400 }
    );
  }

  const verified = await verifySuperAdminPassword(user.email!, password);
  if (!verified) {
    return NextResponse.json(
      { error: "Incorrect password. Please try again." },
      { status: 401 }
    );
  }

  const token = createSuperAdminSessionToken(user.email!);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SUPERADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 2 * 60 * 60,
  });

  return response;
}
