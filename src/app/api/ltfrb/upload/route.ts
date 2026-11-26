import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { authenticateLtfrbAccount, uploadLtfrbDocument } from "@/lib/ltfrb/client";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB (LTFRB limit)

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

  let upload = await uploadLtfrbDocument({
    token,
    file,
    filename: file.name || "document.pdf",
  });

  if (!upload.ok && (upload.httpStatus === 401 || upload.httpStatus === 403)) {
    const auth = await refreshToken();
    if (auth.ok && auth.token) {
      upload = await uploadLtfrbDocument({
        token: auth.token,
        file,
        filename: file.name || "document.pdf",
      });
    }
  }

  if (!upload.ok || !upload.url) {
    return NextResponse.json({ error: upload.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, url: upload.url });
}
