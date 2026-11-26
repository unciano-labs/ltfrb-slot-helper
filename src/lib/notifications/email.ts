import nodemailer from "nodemailer";
import { getOptionalEnv } from "@/lib/env";
import type { AlertSlotMatch } from "@/lib/ltfrb/types";

export interface SlotAlertEmailResult {
  sent: boolean;
  providerId?: string;
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createGmailTransporter() {
  const user = getOptionalEnv("GMAIL_USER");
  const rawAppPassword = getOptionalEnv("GMAIL_APP_PASSWORD");
  if (!user || !rawAppPassword) {
    return null;
  }

  // Gmail App Passwords are 16 chars; normalize spaces if quoted with spaces.
  const pass = rawAppPassword.replace(/\s+/g, "");

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user,
      pass,
    },
  });
}

export async function sendSlotAvailableEmail(params: {
  to: string;
  ruleLabel: string;
  matches: AlertSlotMatch[];
  checkedAtIso: string;
}): Promise<SlotAlertEmailResult> {
  const gmailUser = getOptionalEnv("GMAIL_USER");
  const fromName = getOptionalEnv("GMAIL_FROM_NAME") ?? "LTFRB Slot Helper";
  const rawAppUrl =
    getOptionalEnv("NEXT_PUBLIC_APP_URL") ??
    getOptionalEnv("APP_URL") ??
    "https://ltfrb-foa.ph/";
  const appUrl = rawAppUrl.includes("ltfrb-foa.ph")
    ? rawAppUrl
    : `${rawAppUrl.replace(/\/$/, "")}/dashboard`;

  const transporter = createGmailTransporter();
  if (!transporter || !gmailUser) {
    return {
      sent: false,
      error: "Gmail SMTP credentials (GMAIL_USER / GMAIL_APP_PASSWORD) are not configured.",
    };
  }

  const totalOpen = params.matches.reduce((sum, m) => sum + m.entry.remaining, 0);
  const hasIncrease = params.matches.some(
    (m) => m.reason === "slots_increased" || m.reason === "newly_opened"
  );
  const first = params.matches[0]?.entry;
  const areaLabel = first?.provinceName
    ? `${first.provinceName} (${first.regionName})`
    : first?.regionName ?? "Selected Area";

  const subject = hasIncrease
    ? `LTFRB New Open Slot Ready (${totalOpen} open): ${first?.franchiseTypeName ?? params.ruleLabel} in ${areaLabel}`
    : `LTFRB Slot Update (${totalOpen} open): ${first?.franchiseTypeName ?? params.ruleLabel} in ${areaLabel}`;

  const rowsHtml = params.matches
    .map((m) => {
      const { entry, previousRemaining, delta, reason } = m;
      const place = entry.provinceName
        ? `${escapeHtml(entry.provinceName)}, ${escapeHtml(entry.regionName)}`
        : escapeHtml(entry.regionName);

      const movementNote =
        reason === "slots_increased" && previousRemaining !== null
          ? `Increased from ${previousRemaining} to ${entry.remaining} (+${delta} new slot${delta === 1 ? "" : "s"} — ready to apply!)`
          : reason === "slots_decreased" && previousRemaining !== null
          ? `Decreased from ${previousRemaining} to ${entry.remaining} (${delta})`
          : reason === "newly_opened"
          ? `Newly opened: ${entry.remaining} slot(s) ready`
          : `Currently open: ${entry.remaining} slot(s)`;

      const badgeBg = entry.remaining > 0 ? "#DCFCE7" : "#FEE2E2";
      const badgeColor = entry.remaining > 0 ? "#14532D" : "#7F1D1D";

      return `
        <tr>
          <td style="padding:14px 12px;font-size:17px;color:#17191C;background:#FFFFFF;">
            <strong>${escapeHtml(entry.franchiseTypeName)}</strong><br/>
            <span style="color:#4B5563;">${place}</span><br/>
            <span style="color:#1D4ED8;font-weight:700;">${escapeHtml(movementNote)}</span>
          </td>
          <td style="padding:14px 12px;font-size:20px;font-weight:700;color:${badgeColor};background:${badgeBg};text-align:right;white-space:nowrap;">
            ${entry.remaining} open<br/>
            <span style="font-size:15px;font-weight:400;">of ${entry.totalSlots} total</span>
          </td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#F6F5F1;padding:28px;color:#17191C;">
      <div style="max-width:620px;margin:0 auto;background:#FFFFFF;padding:28px;">
        <h1 style="margin:0 0 12px 0;font-size:26px;line-height:1.3;color:#17191C;">
          LTFRB Franchise Slots Are Open
        </h1>
        <p style="margin:0 0 20px 0;font-size:18px;line-height:1.6;color:#374151;">
          Your watch rule <strong>${escapeHtml(params.ruleLabel)}</strong> found open slots at ${escapeHtml(
            new Date(params.checkedAtIso).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
              dateStyle: "medium",
              timeStyle: "short",
            })
          )}.
        </p>

        <table style="width:100%;border-collapse:separate;border-spacing:0 10px;margin-bottom:24px;">
          ${rowsHtml}
        </table>

        <div style="margin-top:20px;">
          <a href="https://ltfrb-foa.ph/login"
             style="display:inline-block;background:#1D4ED8;color:#FFFFFF;text-decoration:none;font-size:18px;font-weight:700;padding:14px 24px;border-radius:8px;margin-right:12px;">
            Go to LTFRB Login
          </a>
          <a href="${escapeHtml(appUrl)}"
             style="display:inline-block;background:#EEF1F4;color:#17191C;text-decoration:none;font-size:18px;font-weight:700;padding:14px 24px;border-radius:8px;">
            Open Slot Monitor
          </a>
        </div>
      </div>
    </div>
  `;

  try {
    const recipients = params.to
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const info = await transporter.sendMail({
      from: `"${fromName.replace(/"/g, "")}" <${gmailUser}>`,
      to: recipients,
      subject,
      html,
    });

    return { sent: true, providerId: info.messageId };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Unknown Gmail SMTP error",
    };
  }
}

export interface SubmissionEmailParams {
  to: string;
  profileName: string;
  franchiseTypeCode: string;
  regionName: string;
  provinceName: string | null;
  result: "success" | "full_slot" | "auth_error" | "validation_error" | "network_error";
  httpStatus: number | null;
  message: string;
  referenceNumber: string | null;
  safetyStopped?: boolean;
  attemptedAtIso: string;
}

export async function sendSubmissionOutcomeEmail(
  params: SubmissionEmailParams
): Promise<SlotAlertEmailResult> {
  const gmailUser = getOptionalEnv("GMAIL_USER");
  const fromName = getOptionalEnv("GMAIL_FROM_NAME") ?? "LTFRB Slot Helper";
  const transporter = createGmailTransporter();

  if (!transporter || !gmailUser) {
    return { sent: false, error: "Gmail SMTP credentials are not configured." };
  }

  const area = params.provinceName
    ? `${params.provinceName}, ${params.regionName}`
    : params.regionName;

  const isSuccess = params.result === "success";
  const isFullSlot = params.result === "full_slot";

  const subject = isSuccess
    ? params.referenceNumber
      ? `LTFRB Slot Reserved! Case #${params.referenceNumber}`
      : `LTFRB Application Submitted (${params.franchiseTypeCode})`
    : params.safetyStopped
    ? `LTFRB Auto-Submission Paused (HTTP ${params.httpStatus ?? "Alert"})`
    : isFullSlot
    ? `LTFRB Attempt: Slots Full (${params.franchiseTypeCode})`
    : `LTFRB Submission Result (${params.franchiseTypeCode})`;

  const heading = isSuccess
    ? "Your LTFRB Slot Application Was Submitted"
    : params.safetyStopped
    ? "Auto-Submission Was Paused for Safety"
    : isFullSlot
    ? "LTFRB Submission Attempt: Slots Were Full"
    : "LTFRB Submission Attempt Result";

  const headingColor = isSuccess ? "#14532D" : isFullSlot ? "#78350F" : "#7F1D1D";
  const msgBoxBg = isSuccess ? "#DCFCE7" : isFullSlot ? "#FEF3C7" : "#FEE2E2";
  const msgBoxColor = isSuccess ? "#14532D" : isFullSlot ? "#78350F" : "#7F1D1D";

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#F6F5F1;padding:28px;color:#17191C;">
      <div style="max-width:620px;margin:0 auto;background:#FFFFFF;padding:28px;">
        <h1 style="margin:0 0 12px 0;font-size:26px;color:${headingColor};">
          ${escapeHtml(heading)}
        </h1>
        <p style="margin:0 0 18px 0;font-size:18px;line-height:1.6;color:#374151;">
          <strong>Profile:</strong> ${escapeHtml(params.profileName)}<br/>
          <strong>Franchise Type:</strong> ${escapeHtml(params.franchiseTypeCode)}<br/>
          <strong>Area:</strong> ${escapeHtml(area)}<br/>
          ${
            params.referenceNumber
              ? `<strong>Case / Reference Number:</strong> ${escapeHtml(params.referenceNumber)}<br/>`
              : ""
          }
          ${
            params.httpStatus !== null
              ? `<strong>LTFRB HTTP Status:</strong> ${params.httpStatus}<br/>`
              : ""
          }
          <strong>Checked / Attempted At:</strong> ${escapeHtml(
            new Date(params.attemptedAtIso).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
              dateStyle: "medium",
              timeStyle: "short",
            })
          )}
        </p>

        <div style="background:${msgBoxBg};color:${msgBoxColor};padding:18px;border-radius:10px;margin-bottom:22px;">
          <p style="margin:0 0 6px 0;font-size:15px;font-weight:700;">
            LTFRB Return Message:
          </p>
          <p style="margin:0;font-size:18px;line-height:1.5;font-weight:700;">
            ${escapeHtml(params.message)}
          </p>
        </div>

        <a href="https://ltfrb-foa.ph/profile?tab=applications"
           style="display:inline-block;background:#1D4ED8;color:#FFFFFF;text-decoration:none;font-size:18px;font-weight:700;padding:14px 24px;border-radius:8px;">
          Open LTFRB Portal
        </a>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${fromName.replace(/"/g, "")}" <${gmailUser}>`,
      to: params.to
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      subject,
      html,
    });
    return { sent: true, providerId: info.messageId };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Unknown Gmail SMTP error",
    };
  }
}

export async function sendReservationConfirmationEmail(params: {
  to: string;
  profileName: string;
  franchiseTypeCode: string;
  regionName: string;
  provinceName: string | null;
  referenceNumber: string | null;
  submittedAtIso: string;
}): Promise<SlotAlertEmailResult> {
  return sendSubmissionOutcomeEmail({
    to: params.to,
    profileName: params.profileName,
    franchiseTypeCode: params.franchiseTypeCode,
    regionName: params.regionName,
    provinceName: params.provinceName,
    result: "success",
    httpStatus: 201,
    message: params.referenceNumber
      ? `Application submitted! Case Number: ${params.referenceNumber}`
      : "Application submitted to LTFRB!",
    referenceNumber: params.referenceNumber,
    attemptedAtIso: params.submittedAtIso,
  });
}

function getAppBaseUrl(): string {
  const raw =
    getOptionalEnv("NEXT_PUBLIC_APP_URL") ??
    getOptionalEnv("APP_URL") ??
    "https://ltfrb-slot-helper.vercel.app";
  return raw.replace(/\/$/, "");
}

export async function sendPaymentRequestAdminEmail(params: {
  adminEmail: string;
  payerEmail: string;
  amountPhp: number;
  requestTypeLabel: string;
  referenceNumber: string;
  senderName: string | null;
  submittedAtIso: string;
}): Promise<SlotAlertEmailResult> {
  const gmailUser = getOptionalEnv("GMAIL_USER");
  const fromName = getOptionalEnv("GMAIL_FROM_NAME") ?? "LTFRB Slot Helper";
  const transporter = createGmailTransporter();
  if (!transporter || !gmailUser) {
    return { sent: false, error: "Gmail SMTP credentials not configured." };
  }

  const subject = `New QR Payment Proof (₱${params.amountPhp.toLocaleString()}) — ${params.payerEmail}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#F4F4F5;color:#0A0A0A;">
      <div style="background:#FFFFFF;border-radius:12px;padding:24px;">
        <h1 style="margin:0 0 12px 0;font-size:22px;color:#102E7A;">New QR Payment Pending Approval</h1>
        <p style="margin:0 0 14px 0;font-size:17px;">
          <strong>User:</strong> ${escapeHtml(params.payerEmail)}<br/>
          <strong>Plan / Add-on:</strong> ${escapeHtml(params.requestTypeLabel)}<br/>
          <strong>Expected Amount:</strong> ₱${params.amountPhp.toLocaleString()}<br/>
          <strong>Reference No:</strong> ${escapeHtml(params.referenceNumber)}<br/>
          ${params.senderName ? `<strong>Sender Name:</strong> ${escapeHtml(params.senderName)}<br/>` : ""}
          <strong>Submitted:</strong> ${escapeHtml(
            new Date(params.submittedAtIso).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
              dateStyle: "medium",
              timeStyle: "short",
            })
          )}
        </p>
        <a href="${escapeHtml(`${getAppBaseUrl()}/superadmin`)}"
           style="display:inline-block;background:#1447E6;color:#FFFFFF;text-decoration:none;font-size:17px;font-weight:700;padding:12px 22px;border-radius:8px;">
          Review in SuperAdmin
        </a>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${fromName.replace(/"/g, "")}" <${gmailUser}>`,
      to: params.adminEmail,
      subject,
      html,
    });
    return { sent: true, providerId: info.messageId };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Gmail SMTP error" };
  }
}

export async function sendPaymentDecisionUserEmail(params: {
  to: string;
  approved: boolean;
  amountPhp: number;
  requestTypeLabel: string;
  expiresAtIso?: string | null;
  rejectionReason?: string | null;
}): Promise<SlotAlertEmailResult> {
  const gmailUser = getOptionalEnv("GMAIL_USER");
  const fromName = getOptionalEnv("GMAIL_FROM_NAME") ?? "LTFRB Slot Helper";
  const transporter = createGmailTransporter();
  if (!transporter || !gmailUser) {
    return { sent: false, error: "Gmail SMTP credentials not configured." };
  }

  const subject = params.approved
    ? `Payment Approved — Your LTFRB Slot Helper Plan Is Active`
    : `Payment Could Not Be Verified — Action Needed`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#F4F4F5;color:#0A0A0A;">
      <div style="background:#FFFFFF;border-radius:12px;padding:24px;">
        <h1 style="margin:0 0 12px 0;font-size:22px;color:${params.approved ? "#14532D" : "#7F1D1D"};">
          ${params.approved ? "Your Plan & Quotas Are Now Active" : "Payment Verification Update"}
        </h1>
        <p style="margin:0 0 16px 0;font-size:17px;line-height:1.5;">
          <strong>Item:</strong> ${escapeHtml(params.requestTypeLabel)} (₱${params.amountPhp.toLocaleString()})<br/>
          ${
            params.approved && params.expiresAtIso
              ? `<strong>Active Until:</strong> ${escapeHtml(
                  new Date(params.expiresAtIso).toLocaleDateString("en-PH", {
                    timeZone: "Asia/Manila",
                    dateStyle: "long",
                  })
                )}<br/>`
              : ""
          }
          ${
            !params.approved && params.rejectionReason
              ? `<strong>Note from Admin:</strong> ${escapeHtml(params.rejectionReason)}<br/>`
              : ""
          }
        </p>
        <a href="${escapeHtml(`${getAppBaseUrl()}/dashboard`)}"
           style="display:inline-block;background:#1447E6;color:#FFFFFF;text-decoration:none;font-size:17px;font-weight:700;padding:12px 22px;border-radius:8px;">
          Open Your Dashboard
        </a>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${fromName.replace(/"/g, "")}" <${gmailUser}>`,
      to: params.to,
      subject,
      html,
    });
    return { sent: true, providerId: info.messageId };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "Gmail SMTP error" };
  }
}
