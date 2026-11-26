import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getTenantContext } from "@/lib/supabase/server";

export const REG_IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const REG_IP_MAX_ATTEMPTS = 5;
export const REG_IP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const REG_IP_DAILY_MAX_ATTEMPTS = 10;
export const REG_EMAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const REG_EMAIL_MAX_ATTEMPTS = 3;

interface MemoryBucketEntry {
  timestamps: number[];
}

const memoryBuckets = new Map<string, MemoryBucketEntry>();

export function clearInMemoryRateLimitsForTests(): void {
  memoryBuckets.clear();
}

export function extractClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

export function hashIdentifier(value: string, scope: string): string {
  return crypto
    .createHash("sha256")
    .update(`${scope}:${value.trim().toLowerCase()}`, "utf8")
    .digest("hex");
}

function checkWindow(
  key: string,
  maxAttempts: number,
  windowMs: number,
  nowMs: number,
  record: boolean
): { allowed: boolean; retryAfterSeconds: number } {
  const cutoff = nowMs - windowMs;
  const entry = memoryBuckets.get(key);
  const active = (entry?.timestamps ?? []).filter((ts) => ts > cutoff);

  if (active.length >= maxAttempts) {
    const oldestActive = active[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestActive + windowMs - nowMs) / 1000));
    memoryBuckets.set(key, { timestamps: active });
    return { allowed: false, retryAfterSeconds };
  }

  if (record) {
    active.push(nowMs);
    memoryBuckets.set(key, { timestamps: active });
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Pure in-memory sliding-window rate limiter used both as Layer 1 in production
 * and for fast deterministic unit testing.
 */
export function consumeInMemoryRegistrationLimit(params: {
  ipKey: string;
  emailKey?: string;
  nowMs?: number;
  ipMax?: number;
  ipWindowMs?: number;
  emailMax?: number;
  emailWindowMs?: number;
}): { allowed: boolean; retryAfterSeconds: number; message?: string } {
  const nowMs = params.nowMs ?? Date.now();
  const ipMax = params.ipMax ?? REG_IP_MAX_ATTEMPTS;
  const ipWindowMs = params.ipWindowMs ?? REG_IP_WINDOW_MS;
  const emailMax = params.emailMax ?? REG_EMAIL_MAX_ATTEMPTS;
  const emailWindowMs = params.emailWindowMs ?? REG_EMAIL_WINDOW_MS;

  const ipCheck = checkWindow(`ip:${params.ipKey}`, ipMax, ipWindowMs, nowMs, false);
  if (!ipCheck.allowed) {
    const mins = Math.max(1, Math.ceil(ipCheck.retryAfterSeconds / 60));
    return {
      allowed: false,
      retryAfterSeconds: ipCheck.retryAfterSeconds,
      message: `Too many account creation attempts from your connection. Please wait about ${mins} minute${
        mins === 1 ? "" : "s"
      } before trying again.`,
    };
  }

  if (params.emailKey) {
    const emailCheck = checkWindow(
      `email:${params.emailKey}`,
      emailMax,
      emailWindowMs,
      nowMs,
      false
    );
    if (!emailCheck.allowed) {
      const mins = Math.max(1, Math.ceil(emailCheck.retryAfterSeconds / 60));
      return {
        allowed: false,
        retryAfterSeconds: emailCheck.retryAfterSeconds,
        message: `Too many registration attempts for this email address. Please wait about ${mins} minute${
          mins === 1 ? "" : "s"
        } before trying again.`,
      };
    }
  }

  // Record both windows once verified
  checkWindow(`ip:${params.ipKey}`, ipMax, ipWindowMs, nowMs, true);
  if (params.emailKey) {
    checkWindow(`email:${params.emailKey}`, emailMax, emailWindowMs, nowMs, true);
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Checks and records account registration rate limits across both in-memory sliding windows
 * and persistent Supabase attempts (surviving serverless cold starts).
 */
export async function checkAndRecordRegistrationRateLimit(params: {
  ip: string;
  email: string;
}): Promise<{ allowed: boolean; retryAfterSeconds: number; message?: string }> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const memResult = consumeInMemoryRegistrationLimit({
    ipKey: params.ip,
    emailKey: normalizedEmail,
  });

  if (!memResult.allowed) {
    return memResult;
  }

  if (!isSupabaseConfigured()) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  try {
    const { supabase, websiteId } = getTenantContext();
    const ipHash = hashIdentifier(params.ip, websiteId);
    const emailHash = hashIdentifier(normalizedEmail || "empty", websiteId);
    const now = Date.now();
    const fifteenMinAgo = new Date(now - REG_IP_WINDOW_MS).toISOString();
    const dayAgo = new Date(now - REG_IP_DAILY_WINDOW_MS).toISOString();

    const [ipBurstRes, ipDailyRes, emailBurstRes] = await Promise.all([
      supabase
        .from("ltfrb_registration_attempts")
        .select("created_at", { count: "exact", head: true })
        .eq("website_id", websiteId)
        .eq("ip_hash", ipHash)
        .gte("created_at", fifteenMinAgo),
      supabase
        .from("ltfrb_registration_attempts")
        .select("created_at", { count: "exact", head: true })
        .eq("website_id", websiteId)
        .eq("ip_hash", ipHash)
        .gte("created_at", dayAgo),
      supabase
        .from("ltfrb_registration_attempts")
        .select("created_at", { count: "exact", head: true })
        .eq("website_id", websiteId)
        .eq("email_hash", emailHash)
        .gte("created_at", fifteenMinAgo),
    ]);

    const missingTable =
      ipBurstRes.error?.code === "42P01" || ipBurstRes.error?.code === "PGRST205";
    if (missingTable) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if ((ipBurstRes.count ?? 0) >= REG_IP_MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(REG_IP_WINDOW_MS / 1000),
        message:
          "Too many account creation attempts from your connection. Please wait 15 minutes before trying again.",
      };
    }

    if ((ipDailyRes.count ?? 0) >= REG_IP_DAILY_MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfterSeconds: 3600,
        message:
          "Daily account registration limit reached for your connection. Please try again later.",
      };
    }

    if (normalizedEmail && (emailBurstRes.count ?? 0) >= REG_EMAIL_MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(REG_EMAIL_WINDOW_MS / 1000),
        message:
          "Too many registration attempts for this email address. Please wait 15 minutes before trying again.",
      };
    }

    await supabase.from("ltfrb_registration_attempts").insert({
      website_id: websiteId,
      ip_hash: ipHash,
      email_hash: emailHash,
      created_at: new Date(now).toISOString(),
    });
  } catch {
    // Do not break legitimate registration if rate-limit log storage is unreachable
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export interface NormalizedRegistrationInput {
  firstName: string;
  lastName: string;
  fullName: string;
  mobile: string;
  email: string;
  password: string;
}

export function validateAndNormalizeRegistrationInput(body: Record<string, unknown> | null):
  | { valid: true; data: NormalizedRegistrationInput }
  | { valid: false; error: string } {
  const firstName = String(body?.firstName ?? "").trim().replace(/\s+/g, " ");
  const lastName = String(body?.lastName ?? "").trim().replace(/\s+/g, " ");
  const rawMobile = String(body?.mobile ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (firstName.length < 1 || firstName.length > 80) {
    return { valid: false, error: "Please enter your first name." };
  }

  if (lastName.length < 1 || lastName.length > 80) {
    return { valid: false, error: "Please enter your last name." };
  }

  const compactDigits = rawMobile.replace(/[\s\-().]/g, "");
  let normalizedMobile = compactDigits;

  // Normalize Philippine mobile numbers cleanly (09XXXXXXXXX -> +639XXXXXXXXX)
  if (/^09\d{9}$/.test(compactDigits)) {
    normalizedMobile = `+63${compactDigits.slice(1)}`;
  } else if (/^639\d{9}$/.test(compactDigits)) {
    normalizedMobile = `+${compactDigits}`;
  } else if (/^\+639\d{9}$/.test(compactDigits)) {
    normalizedMobile = compactDigits;
  } else if (!/^\+?\d{10,15}$/.test(compactDigits)) {
    return {
      valid: false,
      error: "Please enter a valid mobile number (for example: 09171234567).",
    };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: "Please enter a valid email address." };
  }

  if (password.length < 6) {
    return {
      valid: false,
      error: "Please enter a password of at least 6 characters.",
    };
  }

  return {
    valid: true,
    data: {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      mobile: normalizedMobile,
      email,
      password,
    },
  };
}
