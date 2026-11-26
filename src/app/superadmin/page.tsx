import { redirect } from "next/navigation";
import SuperAdminConsole from "@/components/SuperAdminConsole";
import SuperAdminPasswordGate from "@/components/SuperAdminPasswordGate";
import { isSuperAdminEmail } from "@/lib/monitor/monetization";
import { isSuperAdminCookieValid } from "@/lib/security/superadmin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  if (!isSuperAdminEmail(user.email)) {
    redirect("/dashboard");
  }

  const unlocked = await isSuperAdminCookieValid(user.email);
  if (!unlocked) {
    return <SuperAdminPasswordGate adminEmail={user.email!} />;
  }

  return <SuperAdminConsole adminEmail={user.email!} />;
}
