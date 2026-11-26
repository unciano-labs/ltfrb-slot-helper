import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequiredEnv, getSupabaseUrl, getWebsiteId } from "@/lib/env";

let cachedAdminClient: SupabaseClient | null = null;

/**
 * Returns a server-side Supabase client authenticated with the service role key.
 * All queries MUST filter by `getWebsiteId()` to preserve multi-tenant isolation.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cachedAdminClient) return cachedAdminClient;

  const url = getSupabaseUrl();
  const serviceKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  cachedAdminClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
}

export function getTenantContext() {
  return {
    supabase: getSupabaseAdmin(),
    websiteId: getWebsiteId(),
  };
}
