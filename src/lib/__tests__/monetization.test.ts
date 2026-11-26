import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDON_ALERT_PRICE_PHP,
  ADDON_PROFILE_PRICE_PHP,
  ANNUAL_PLAN_PRICE_PHP,
  calculatePaymentOrder,
  computeApprovedExpiryIso,
  isSuperAdminEmail,
  resolveUserEntitlements,
  SUPERADMIN_EMAIL,
  type SubscriptionRow,
} from "@/lib/monitor/monetization";
import {
  isFranchiseAllowedForAccount,
  normalizeSelectedFranchises,
} from "@/lib/monitor/preferences";
import {
  createSuperAdminSessionToken,
  verifySuperAdminSessionToken,
} from "@/lib/security/superadmin";

describe("monetization pricing and entitlements", () => {
  it("calculates annual plan and add-on totals accurately", () => {
    const annualOnly = calculatePaymentOrder({
      includesAnnualPlan: true,
      extraProfiles: 0,
      extraAlerts: 0,
    });
    assert.equal(annualOnly.valid, true);
    assert.equal(annualOnly.requestType, "annual_plan");
    assert.equal(annualOnly.expectedAmountPhp, ANNUAL_PLAN_PRICE_PHP);

    const bundle = calculatePaymentOrder({
      includesAnnualPlan: true,
      extraProfiles: 2,
      extraAlerts: 3,
    });
    assert.equal(bundle.valid, true);
    assert.equal(bundle.requestType, "bundle");
    assert.equal(
      bundle.expectedAmountPhp,
      ANNUAL_PLAN_PRICE_PHP + 2 * ADDON_PROFILE_PRICE_PHP + 3 * ADDON_ALERT_PRICE_PHP
    );

    const addonOnly = calculatePaymentOrder({
      includesAnnualPlan: false,
      extraProfiles: 1,
      extraAlerts: 2,
    });
    assert.equal(addonOnly.valid, true);
    assert.equal(addonOnly.requestType, "addon");
    assert.equal(addonOnly.expectedAmountPhp, 300);

    const empty = calculatePaymentOrder({
      includesAnnualPlan: false,
      extraProfiles: 0,
      extraAlerts: 0,
    });
    assert.equal(empty.valid, false);
  });

  it("computes 365-day extensions from active or expired dates", () => {
    const now = new Date("2026-11-27T00:00:00.000Z");
    const freshExpiry = computeApprovedExpiryIso(null, now);
    assert.equal(freshExpiry, "2027-11-27T00:00:00.000Z");

    const futureExpiry = computeApprovedExpiryIso("2027-01-01T00:00:00.000Z", now);
    assert.equal(futureExpiry, "2028-01-01T00:00:00.000Z");
  });

  it("resolves user entitlements for unpaid, active, expired, disabled, and SuperAdmin", () => {
    const now = new Date("2026-11-27T00:00:00.000Z");

    const superAdmin = resolveUserEntitlements({
      subscription: null,
      userEmail: SUPERADMIN_EMAIL,
      usedProfiles: 1,
      usedAlerts: 1,
      monitoredCodesCount: 1,
      now,
    });
    assert.equal(superAdmin.isSuperAdmin, true);
    assert.equal(superAdmin.isActivePlan, true);
    assert.equal(superAdmin.isDisabled, false);

    const unpaid = resolveUserEntitlements({
      subscription: null,
      userEmail: "driver@example.com",
      usedProfiles: 0,
      usedAlerts: 0,
      monitoredCodesCount: 0,
      now,
    });
    assert.equal(unpaid.isActivePlan, false);
    assert.equal(unpaid.status, "unpaid");
    assert.equal(unpaid.maxAutoReserveProfiles, 1);
    assert.equal(unpaid.maxAlertSlots, 1);

    const activeSub: SubscriptionRow = {
      id: "sub-1",
      website_id: "site-1",
      user_id: "u-1",
      user_email: "driver@example.com",
      plan_code: "annual_1699",
      status: "active",
      is_disabled: false,
      disabled_reason: null,
      base_auto_reserve_limit: 1,
      extra_auto_reserve_slots: 2,
      base_alert_slot_limit: 1,
      extra_alert_slots: 1,
      starts_at: "2026-11-20T00:00:00.000Z",
      expires_at: "2027-11-20T00:00:00.000Z",
      notes: null,
      created_at: "2026-11-20T00:00:00.000Z",
      updated_at: "2026-11-20T00:00:00.000Z",
    };

    const active = resolveUserEntitlements({
      subscription: activeSub,
      userEmail: "driver@example.com",
      usedProfiles: 2,
      usedAlerts: 1,
      monitoredCodesCount: 2,
      now,
    });
    assert.equal(active.isActivePlan, true);
    assert.equal(active.maxAutoReserveProfiles, 3);
    assert.equal(active.maxAlertSlots, 2);

    const disabled = resolveUserEntitlements({
      subscription: { ...activeSub, is_disabled: true, disabled_reason: "Refund" },
      userEmail: "driver@example.com",
      usedProfiles: 2,
      usedAlerts: 1,
      monitoredCodesCount: 2,
      now,
    });
    assert.equal(disabled.isDisabled, true);
    assert.equal(disabled.isActivePlan, false);
  });

  it("enforces dynamic monitored franchise quotas from entitlements", () => {
    const cap1 = normalizeSelectedFranchises(["TNVS", "E_TNVS"], 1);
    assert.equal(cap1.valid, false);

    const cap3 = normalizeSelectedFranchises(["TNVS", "E_TNVS", "EVT"], 3);
    assert.equal(cap3.valid, true);
    assert.equal(cap3.codes.length, 3);

    assert.equal(isFranchiseAllowedForAccount("EVT", ["TNVS", "E_TNVS", "EVT"], 1), false);
    assert.equal(isFranchiseAllowedForAccount("EVT", ["TNVS", "E_TNVS", "EVT"], 3), true);
  });
});

describe("SuperAdmin email and session cookie security", () => {
  it("matches strictly only webcareer1@gmail.com case-insensitively", () => {
    assert.equal(isSuperAdminEmail("webcareer1@gmail.com"), true);
    assert.equal(isSuperAdminEmail(" WebCareer1@Gmail.com "), true);
    assert.equal(isSuperAdminEmail("other@gmail.com"), false);
    assert.equal(isSuperAdminEmail(null), false);
  });

  it("creates and validates signed SuperAdmin tokens with expiration and tamper resistance", () => {
    const secret = "unit-test-superadmin-secret";
    const now = Date.UTC(2026, 10, 27, 4, 0, 0);
    const token = createSuperAdminSessionToken(SUPERADMIN_EMAIL, now, secret);

    assert.equal(verifySuperAdminSessionToken(token, SUPERADMIN_EMAIL, now + 1000, secret), true);
    assert.equal(verifySuperAdminSessionToken(token, "attacker@gmail.com", now + 1000, secret), false);
    assert.equal(
      verifySuperAdminSessionToken(token, SUPERADMIN_EMAIL, now + 3 * 60 * 60 * 1000, secret),
      false
    );
    assert.equal(verifySuperAdminSessionToken(`${token}tamper`, SUPERADMIN_EMAIL, now + 1000, secret), false);
  });
});
