import { redirect } from "next/navigation";
import MonitorApp from "@/components/MonitorApp";
import { loadDashboardData } from "@/lib/monitor/dashboard-data";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const initialData = await loadDashboardData({
    mode: "cached",
    knownUser: { id: user.id, email: user.email ?? null },
  });

  return <MonitorApp initialData={initialData} />;
}
