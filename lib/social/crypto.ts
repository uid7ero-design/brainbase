import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.SOCIAL_TOKEN_SECRET;

  if (!secret) {
    console.warn(
      "[social/crypto] SOCIAL_TOKEN_SECRET is not set — using hardcoded fallback key. " +
        "This is insecure outside of demo mode. Set the env var in production."
    );
    // 32-byte fallback for demo mode only
    return Buffer.from("brainbase-social-demo-key-000000", "utf8").subarray(0, 32);
  }

  // Pad or truncate to exactly 32 bytes
  const keyBuf = Buffer.alloc(32);
  const secretBuf = Buffer.from(secret, "utf8");
  secretBuf.copy(keyBuf, 0, 0, Math.min(secretBuf.length, 32));
  return keyBuf;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a colon-delimited string: `iv_hex:tag_hex:ciphertext_hex`
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypts a string produced by `encrypt`.
 * Expects the format: `iv_hex:tag_hex:ciphertext_hex`
 */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");

  if (parts.length !== 3) {
    throw new Error(
      "[social/crypto] Invalid ciphertext format — expected iv_hex:tag_hex:ciphertext_hex"
    );
  }

  const [ivHex, tagHex, dataHex] = parts;

  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error("[social/crypto] Invalid IV length in ciphertext");
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error("[social/crypto] Invalid auth tag length in ciphertext");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  return decrypted.toString("utf8");
}
