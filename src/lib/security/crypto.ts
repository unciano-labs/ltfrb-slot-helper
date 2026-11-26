import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(secretBase64?: string): Buffer {
  const raw = secretBase64 ?? process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("Missing ENCRYPTION_KEY environment variable.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256-GCM).");
  }
  return key;
}

/**
 * Encrypts a UTF-8 plaintext string using AES-256-GCM.
 * Output format: base64(iv).base64(authTag).base64(ciphertext)
 */
export function encryptSecret(plaintext: string, secretBase64?: string): string {
  const key = getEncryptionKey(secretBase64);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

/**
 * Decrypts a payload created by `encryptSecret`.
 */
export function decryptSecret(payload: string, secretBase64?: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = getEncryptionKey(secretBase64);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Constant-time bearer token check for cron endpoints.
 */
export function verifyCronBearerToken(authHeader: string | null, expectedSecret?: string): boolean {
  const secret = expectedSecret ?? process.env.CRON_SECRET?.trim();
  if (!secret || !authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length).trim();
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
