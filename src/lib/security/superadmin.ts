import crypto from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getOptionalEnv, getSupabaseUrl } from "@/lib/env";
import { isSuperAdminEmail, SUPERADMIN_EMAIL } from "@/lib/monitor/monetization";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const SUPERADMIN_COOKIE_NAME = "ltfrb_superadmin_session";
const SUPERADMIN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getSigningKey(customSecret?: string): Buffer {
  const raw =
    customSecret ??
    getOptionalEnv("SUPERADMIN_SESSION_SECRET") ??
    getOptionalEnv("ENCRYPTION_KEY") ??
    getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!raw) {
    throw new Error("Missing server secret for SuperAdmin session signing.");
  }

  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function createSuperAdminSessionToken(
  email: string,
  nowMs: number = Date.now(),
  customSecret?: string
): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: email.trim().toLowerCase(),
      exp: nowMs + SUPERADMIN_TTL_MS,
    }),
    "utf8"
  ).toString("base64url");

  const sig = crypto
    .createHmac("sha256", getSigningKey(customSecret))
    .update(payload)
    .digest("base64url");

  return `${payload}.${sig}`;
}

export function verifySuperAdminSessionToken(
  token: string | undefined,
  expectedEmail: string = SUPERADMIN_EMAIL,
  nowMs: number = Date.now(),
  customSecret?: string
): boolean {
  if (!token || !isSuperAdminEmail(expectedEmail)) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  try {
    const expectedSig = crypto
      .createHmac("sha256", getSigningKey(customSecret))
      .update(payload)
      .digest("base64url");

    const sigBuf = Buffer.from(sig, "utf8");
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return false;
    }

    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { email?: string; exp?: number };

    if (!isSuperAdminEmail(decoded.email) || typeof decoded.exp !== "number") {
      return false;
    }

    return decoded.exp > nowMs;
  } catch {
    return false;
  }
}

/**
 * Verifies the SuperAdmin password against webcareer1@gmail.com via Supabase Auth
 * (and optional SUPERADMIN_PASSCODE env override if configured).
 */
export async function verifySuperAdminPassword(
  email: string,
  password: string
): Promise<boolean> {
  if (!isSuperAdminEmail(email) || !password) return false;

  const passcodeOverride = getOptionalEnv("SUPERADMIN_PASSCODE");
  if (passcodeOverride) {
    const a = Buffer.from(password, "utf8");
    const b = Buffer.from(passcodeOverride, "utf8");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }

  const anonKey =
    getOptionalEnv("NEXT_SUPABASE_ANON_KEY") ??
    getOptionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!anonKey) return false;

  const client = createClient(getSupabaseUrl(), anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: SUPERADMIN_EMAIL,
    password,
  });

  return Boolean(!error && data.user && isSuperAdminEmail(data.user.email));
}

export async function isSuperAdminCookieValid(userEmail: string | null | undefined): Promise<boolean> {
  if (!isSuperAdminEmail(userEmail)) return false;
  const cookieStore = await cookies();
  const token = cookieStore.get(SUPERADMIN_COOKIE_NAME)?.value;
  return verifySuperAdminSessionToken(token, userEmail ?? SUPERADMIN_EMAIL);
}

/**
 * Strictly guards SuperAdmin API routes: requires logged-in webcareer1@gmail.com + valid password session cookie.
 */
export async function requireSuperAdmin(): Promise<
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, status: 401, error: "Please sign in first." };
  }

  if (!isSuperAdminEmail(user.email)) {
    return { ok: false, status: 403, error: "Access denied. SuperAdmin only." };
  }

  const cookieValid = await isSuperAdminCookieValid(user.email);
  if (!cookieValid) {
    return {
      ok: false,
      status: 401,
      error: "Please confirm your SuperAdmin password to continue.",
    };
  }

  return { ok: true, user };
}
