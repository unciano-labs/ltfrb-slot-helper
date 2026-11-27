import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  authenticateLtfrbAccount,
  uploadLtfrbDocument,
  VEHICLE_DOCS_STORAGE_BUCKET,
} from "@/lib/ltfrb/client";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB (LTFRB limit)

async function ensurePrivatePdfBucket(supabase: SupabaseClient): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets ?? []).some((b) => b.name === VEHICLE_DOCS_STORAGE_BUCKET);
  if (!exists) {
    await supabase.storage.createBucket(VEHICLE_DOCS_STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_BYTES,
      allowedMimeTypes: ["application/pdf"],
    });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Please choose a PDF file to upload." },
      { status: 400 }
    );
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "LTFRB only accepts PDF files (.pdf). Please select a PDF file." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "This PDF is larger than 5 MB. Please choose a smaller PDF file." },
      { status: 400 }
    );
  }

  const { supabase, websiteId } = getTenantContext();
  const { data: accountRow } = await supabase
    .from("ltfrb_accounts")
    .select("*")
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!accountRow) {
    return NextResponse.json(
      { error: "Please save your LTFRB login in '3. My LTFRB Account' before uploading files." },
      { status: 400 }
    );
  }

  // Save a private durable copy in Supabase Storage so expired LTFRB S3 URLs can always be viewed & auto-reuploaded
  await ensurePrivatePdfBucket(supabase);
  const safeName = (file.name || "document.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const storagePath = `${websiteId}/${user.id}/${Date.now()}-${safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`}`;
  const pdfBuffer = Buffer.from(await file.arrayBuffer());

  const { error: backupErr } = await supabase.storage
    .from(VEHICLE_DOCS_STORAGE_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (backupErr) {
    return NextResponse.json(
      { error: `Could not back up PDF securely: ${backupErr.message}` },
      { status: 500 }
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
        { error: auth.message ?? "Could not sign in to LTFRB to upload the file." },
        { status: 401 }
      );
    }
    token = auth.token;
  }

  const freshBlob = new Blob([pdfBuffer], { type: "application/pdf" });
  let upload = await uploadLtfrbDocument({
    token,
    file: freshBlob,
    filename: safeName,
  });

  if (!upload.ok && (upload.httpStatus === 401 || upload.httpStatus === 403)) {
    const auth = await refreshToken();
    if (auth.ok && auth.token) {
      upload = await uploadLtfrbDocument({
        token: auth.token,
        file: freshBlob,
        filename: safeName,
      });
    }
  }

  if (!upload.ok || !upload.url) {
    await supabase.storage.from(VEHICLE_DOCS_STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: upload.message }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    url: upload.url,
    storagePath,
  });
}
