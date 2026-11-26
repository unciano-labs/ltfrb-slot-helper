import { NextRequest, NextResponse } from "next/server";
import { attemptSlotReservation } from "@/lib/ltfrb/reservation";
import { assertUserCanManageAutomation } from "@/lib/monitor/entitlements";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const gate = await assertUserCanManageAutomation(user.id, user.email);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const profileId = String(body?.profileId ?? "").trim();
  if (!profileId) {
    return NextResponse.json(
      { error: "Missing reservation profile ID." },
      { status: 400 }
    );
  }

  const summary = await attemptSlotReservation({
    profileId,
    userId: user.id,
  });

  return NextResponse.json({ ok: summary.result === "success", summary });
}
