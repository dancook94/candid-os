import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
  const encoded = process.env.GMAIL_TOKEN_KEY?.trim();

  if (!encoded) {
    throw new Error("GMAIL_TOKEN_KEY is not configured.");
  }

  const key = Buffer.from(encoded, "base64");

  if (key.length !== 32) {
    throw new Error("GMAIL_TOKEN_KEY must be 32 bytes, base64-encoded.");
  }

  return key;
}

export function encryptGmailRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptGmailRefreshToken(payload: string) {
  const buffer = Buffer.from(payload, "base64");

  if (buffer.length < 29) {
    throw new Error("The stored Gmail token could not be read.");
  }

  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
