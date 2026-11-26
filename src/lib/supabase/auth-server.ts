import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getOptionalEnv, getSupabaseUrl } from "@/lib/env";

function getSupabaseAnonKey(): string {
  const key =
    getOptionalEnv("NEXT_SUPABASE_ANON_KEY") ??
    getOptionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!key) {
    throw new Error(
      "Missing Supabase anon key: set NEXT_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return key;
}

/**
 * Creates a cookie-aware Supabase SSR client for Server Components and Route Handlers.
 */
export async function createSupabaseAuthServerClient() {
  const cookieStore = await cookies();
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Ignore cookie writes inside Server Component render passes
        }
      },
    },
  });
}

/**
 * Returns the authenticated Supabase user from the request cookies, or null if signed out.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  try {
    const supabase = await createSupabaseAuthServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}
