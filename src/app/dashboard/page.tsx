import MonitorApp from "@/components/MonitorApp";
import { loadDashboardData } from "@/lib/monitor/dashboard-data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initialData = await loadDashboardData({ mode: "cached" });
  return <MonitorApp initialData={initialData} />;
}
