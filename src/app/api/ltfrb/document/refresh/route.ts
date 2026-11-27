import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  authenticateLtfrbAccount,
  uploadLtfrbDocument,
  VEHICLE_DOCS_STORAGE_BUCKET,
} from "@/lib/ltfrb/client";
import type { UnitDocumentKey, VehicleUnitInput } from "@/lib/ltfrb/types";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_DOC_KEYS = new Set<UnitDocumentKey>([
  "sales_invoice_file",
  "or_file",
  "cr_file",
  "affidavit_file",
  "delivery_receipt",
  "unit_photo_file",
]);

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const storagePath = String(body?.storagePath ?? "").trim();
  const profileId = body?.profileId ? String(body.profileId).trim() : null;
  const unitIndex = Number(body?.unitIndex ?? 0) || 0;
  const docKey = String(body?.docKey ?? "sales_invoice_file").trim() as UnitDocumentKey;

  if (!ALLOWED_DOC_KEYS.has(docKey)) {
    return NextResponse.json({ error: "Invalid document field key." }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();
  const requiredPrefix = `${websiteId}/${user.id}/`;
  if (!storagePath || storagePath.includes("..") || !storagePath.startsWith(requiredPrefix)) {
    return NextResponse.json(
      { error: "Access denied. Invalid document backup path." },
      { status: 403 }
    );
  }

  const [{ data: pdfBlob, error: downloadErr }, { data: accountRow }] = await Promise.all([
    supabase.storage.from(VEHICLE_DOCS_STORAGE_BUCKET).download(storagePath),
    supabase
      .from("ltfrb_accounts")
      .select("*")
      .eq("website_id", websiteId)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (downloadErr || !pdfBlob) {
    return NextResponse.json(
      { error: downloadErr?.message || "Could not find your backed-up PDF file." },
      { status: 404 }
    );
  }

  if (!accountRow) {
    return NextResponse.json(
      { error: "Please save your LTFRB login in '3. LTFRB Account' first." },
      { status: 400 }
    );
  }

  const refreshToken = async (): Promise<{ ok: boolean; token?: string; message?: string }> => {
    const password = decryptSecret(accountRow.encrypted_password as string);
    const auth = await authenticateLtfrbAccount({
      accountType: (accountRow.account_type as "operator" | "tnc") ?? "operator",
      email: accountRow.ltfrb_email as string,
      password,
    });
    if (auth.ok && auth.token) {
      await supabase
        .from("ltfrb_accounts")
        .update({
          encrypted_token: encryptSecret(auth.token),
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", accountRow.id)
        .eq("website_id", websiteId);
    }
    return auth;
  };

  let token = accountRow.encrypted_token
    ? decryptSecret(accountRow.encrypted_token as string)
    : null;
  if (!token) {
    const auth = await refreshToken();
    if (!auth.ok || !auth.token) {
      return NextResponse.json(
        { error: auth.message ?? "Could not sign in to LTFRB." },
        { status: 401 }
      );
    }
    token = auth.token;
  }

  const filename = storagePath.split("/").pop() || "document.pdf";
  let upload = await uploadLtfrbDocument({
    token,
    file: pdfBlob,
    filename,
  });

  if (!upload.ok && (upload.httpStatus === 401 || upload.httpStatus === 403)) {
    const auth = await refreshToken();
    if (auth.ok && auth.token) {
      upload = await uploadLtfrbDocument({
        token: auth.token,
        file: pdfBlob,
        filename,
      });
    }
  }

  if (!upload.ok || !upload.url) {
    return NextResponse.json({ error: upload.message }, { status: 502 });
  }

  if (profileId) {
    const { data: existingProfile } = await supabase
      .from("ltfrb_application_profiles")
      .select("units")
      .eq("id", profileId)
      .eq("website_id", websiteId)
      .eq("user_id", user.id)
      .maybeSingle();

    const units = Array.isArray(existingProfile?.units)
      ? ([...existingProfile.units] as VehicleUnitInput[])
      : [];

    if (units[unitIndex]) {
      units[unitIndex] = {
        ...units[unitIndex],
        documents: {
          ...(units[unitIndex].documents ?? {}),
          [docKey]: upload.url,
        },
      };
      await supabase
        .from("ltfrb_application_profiles")
        .update({
          units,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profileId)
        .eq("website_id", websiteId)
        .eq("user_id", user.id);
    }
  }

  return NextResponse.json({
    ok: true,
    url: upload.url,
  });
}
