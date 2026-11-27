import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { VEHICLE_DOCS_STORAGE_BUCKET } from "@/lib/ltfrb/client";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const storagePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  const { supabase, websiteId } = getTenantContext();
  const requiredPrefix = `${websiteId}/${user.id}/`;

  if (!storagePath || storagePath.includes("..") || !storagePath.startsWith(requiredPrefix)) {
    return NextResponse.json(
      { error: "Access denied. Document path is invalid or belongs to another user." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase.storage
    .from(VEHICLE_DOCS_STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Document backup could not be found." },
      { status: 404 }
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  const filename = storagePath.split("/").pop() || "document.pdf";

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
