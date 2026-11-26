import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  return NextResponse.json({
    user: user ? { id: user.id, email: user.email ?? null } : null,
  });
}
