/**
 * Server-side environment helpers.
 * Supports both `NEXT_SUPABASE_*` and `NEXT_PUBLIC_SUPABASE_*` naming conventions.
 * Never import this file from Client Components.
 */

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getSupabaseUrl(): string {
  const url =
    getOptionalEnv("NEXT_SUPABASE_URL") ?? getOptionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (!url) {
    throw new Error(
      "Missing Supabase URL: set NEXT_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL."
    );
  }
  return url;
}

export function getWebsiteId(): string {
  return getRequiredEnv("WEBSITE_ID");
}

export function isSupabaseConfigured(): boolean {
  const hasUrl = Boolean(
    getOptionalEnv("NEXT_SUPABASE_URL") ?? getOptionalEnv("NEXT_PUBLIC_SUPABASE_URL")
  );
  return Boolean(
    hasUrl &&
      getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY") &&
      getOptionalEnv("WEBSITE_ID")
  );
}
