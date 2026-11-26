import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  ensureStorageBucket,
  QR_STORAGE_BUCKET,
  type PaymentProvider,
} from "@/lib/monitor/monetization";
import { requireSuperAdmin } from "@/lib/security/superadmin";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const rawProvider = String(formData?.get("provider") ?? "gcash").toLowerCase();
  const provider: PaymentProvider =
    rawProvider === "maya" ? "maya" : rawProvider === "other" ? "other" : "gcash";
  const title = String(formData?.get("title") ?? "").trim();
  const description = String(formData?.get("description") ?? "").trim();
  const sortOrder = Number(formData?.get("sortOrder") ?? 0) || 0;

  if (!title) {
    return NextResponse.json(
      { error: "Please enter a QR title (for example: GCash Main Account)." },
      { status: 400 }
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Please choose a QR code image (PNG, JPG, or WEBP)." },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Only PNG, JPG, WEBP, or GIF images are allowed." },
      { status: 400 }
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "QR image must be smaller than 5 MB." },
      { status: 400 }
    );
  }

  const { supabase, websiteId } = getTenantContext();
  await ensureStorageBucket(supabase, QR_STORAGE_BUCKET, true);

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `${websiteId}/${provider}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(QR_STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage
    .from(QR_STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("ltfrb_payment_qr_codes")
    .insert({
      website_id: websiteId,
      provider,
      title,
      description,
      image_url: urlData.publicUrl,
      storage_path: storagePath,
      is_active: true,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await supabase.from("ltfrb_admin_audit_logs").insert({
    website_id: websiteId,
    admin_email: guard.user.email!,
    action: "upload_qr",
    details: { qrId: inserted.id, provider, title },
  });

  return NextResponse.json({ ok: true, qrCode: inserted });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = String(body?.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "QR Code ID is required." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body?.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body?.description === "string") patch.description = body.description.trim();
  if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
  if (body?.provider === "gcash" || body?.provider === "maya" || body?.provider === "other") {
    patch.provider = body.provider;
  }

  const { supabase, websiteId } = getTenantContext();
  const { data, error } = await supabase
    .from("ltfrb_payment_qr_codes")
    .update(patch)
    .eq("id", id)
    .eq("website_id", websiteId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, qrCode: data });
}

export async function DELETE(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "QR Code ID is required." }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();
  const { data: existing } = await supabase
    .from("ltfrb_payment_qr_codes")
    .select("storage_path, title")
    .eq("id", id)
    .eq("website_id", websiteId)
    .maybeSingle();

  const { error } = await supabase
    .from("ltfrb_payment_qr_codes")
    .delete()
    .eq("id", id)
    .eq("website_id", websiteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (existing?.storage_path) {
    await supabase.storage
      .from(QR_STORAGE_BUCKET)
      .remove([existing.storage_path as string]);
  }

  await supabase.from("ltfrb_admin_audit_logs").insert({
    website_id: websiteId,
    admin_email: guard.user.email!,
    action: "delete_qr",
    details: { qrId: id, title: existing?.title ?? null },
  });

  return NextResponse.json({ ok: true });
}
