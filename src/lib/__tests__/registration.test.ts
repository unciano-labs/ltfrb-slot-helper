import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearInMemoryRateLimitsForTests,
  consumeInMemoryRegistrationLimit,
  validateAndNormalizeRegistrationInput,
} from "@/lib/security/registration";

describe("registration input validation and normalization", () => {
  it("validates required first name, last name, mobile, email, and password", () => {
    const missingName = validateAndNormalizeRegistrationInput({
      firstName: "",
      lastName: "Dela Cruz",
      mobile: "09171234567",
      email: "juan@example.com",
      password: "password123",
    });
    assert.equal(missingName.valid, false);

    const badMobile = validateAndNormalizeRegistrationInput({
      firstName: "Juan",
      lastName: "Dela Cruz",
      mobile: "12345",
      email: "juan@example.com",
      password: "password123",
    });
    assert.equal(badMobile.valid, false);

    const validPh = validateAndNormalizeRegistrationInput({
      firstName: " Juan ",
      lastName: " Dela   Cruz ",
      mobile: "0917-123-4567",
      email: " Juan@Example.com ",
      password: "password123",
    });
    assert.equal(validPh.valid, true);
    if (validPh.valid) {
      assert.equal(validPh.data.firstName, "Juan");
      assert.equal(validPh.data.lastName, "Dela Cruz");
      assert.equal(validPh.data.fullName, "Juan Dela Cruz");
      assert.equal(validPh.data.mobile, "+639171234567");
      assert.equal(validPh.data.email, "juan@example.com");
    }
  });

  it("enforces sliding-window rate limits per IP and per email", () => {
    clearInMemoryRateLimitsForTests();
    const baseTime = Date.UTC(2026, 10, 27, 5, 0, 0);

    // Email cap (3 attempts within 15 mins)
    for (let i = 0; i < 3; i += 1) {
      const ok = consumeInMemoryRegistrationLimit({
        ipKey: `ip-a-${i}`,
        emailKey: "spam@example.com",
        nowMs: baseTime + i * 1000,
      });
      assert.equal(ok.allowed, true);
    }
    const fourthEmail = consumeInMemoryRegistrationLimit({
      ipKey: "ip-a-99",
      emailKey: "spam@example.com",
      nowMs: baseTime + 5000,
    });
    assert.equal(fourthEmail.allowed, false);

    // IP burst cap (5 attempts within 15 mins across distinct emails)
    clearInMemoryRateLimitsForTests();
    for (let i = 0; i < 5; i += 1) {
      const ok = consumeInMemoryRegistrationLimit({
        ipKey: "203.0.113.10",
        emailKey: `user${i}@example.com`,
        nowMs: baseTime + i * 1000,
      });
      assert.equal(ok.allowed, true);
    }
    const sixthIp = consumeInMemoryRegistrationLimit({
      ipKey: "203.0.113.10",
      emailKey: "user5@example.com",
      nowMs: baseTime + 10_000,
    });
    assert.equal(sixthIp.allowed, false);
    assert.ok(sixthIp.retryAfterSeconds > 0);

    // Window expires cleanly after 15+ minutes
    const afterWindow = consumeInMemoryRegistrationLimit({
      ipKey: "203.0.113.10",
      emailKey: "user5@example.com",
      nowMs: baseTime + 16 * 60 * 1000,
    });
    assert.equal(afterWindow.allowed, true);
  });
});
