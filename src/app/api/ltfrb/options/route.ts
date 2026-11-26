import { NextRequest, NextResponse } from "next/server";
import {
  fetchLtfrbProvinces,
  fetchLtfrbRegions,
  fetchLtfrbRoutes,
} from "@/lib/ltfrb/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const franchiseTypeCode =
    request.nextUrl.searchParams.get("franchise_type_code")?.trim() || undefined;
  const regionCode = request.nextUrl.searchParams.get("region_code")?.trim() || undefined;
  const regionId = request.nextUrl.searchParams.get("region_id")?.trim() || undefined;

  try {
    const [regions, provinces, routes] = await Promise.all([
      fetchLtfrbRegions(franchiseTypeCode),
      regionCode ? fetchLtfrbProvinces(regionCode, franchiseTypeCode) : Promise.resolve([]),
      regionId ? fetchLtfrbRoutes(regionId) : Promise.resolve([]),
    ]);

    return NextResponse.json({ regions, provinces, routes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load LTFRB options." },
      { status: 502 }
    );
  }
}
