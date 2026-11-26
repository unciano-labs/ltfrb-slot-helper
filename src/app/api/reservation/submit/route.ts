import { NextRequest, NextResponse } from "next/server";
import { attemptSlotReservation } from "@/lib/ltfrb/reservation";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
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
