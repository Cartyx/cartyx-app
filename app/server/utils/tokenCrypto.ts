import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Encrypted OAuth provider tokens at rest.
 *
 * Provider access/refresh tokens are sensitive bearer credentials. We keep them
 * OUT of the client-held session cookie and store them on the User document,
 * encrypted with AES-256-GCM. The encryption key is derived from the existing
 * SESSION_SECRET env var, so no new required env var is introduced.
 *
 * Each ciphertext carries its own random IV plus the GCM auth tag, so tampering
 * (or a key mismatch) is detected at decrypt time and surfaces as an error.
 */

export interface EncryptedToken {
  /** Base64 ciphertext */
  ciphertext: string;
  /** Base64 random IV (12 bytes, GCM standard) */
  iv: string;
  /** Base64 GCM authentication tag */
  authTag: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce recommended for GCM
const KEY_LENGTH = 32; // 256-bit key

// App-specific, fixed salt so the derived key is stable across processes/deploys
// while remaining distinct from any other use of SESSION_SECRET.
const KEY_SALT = 'cartyx-oauth-token-encryption-v1';

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is not set');
  // scrypt is intentionally slow but key derivation happens only on login/logout,
  // which are low-frequency operations.
  return scryptSync(secret, KEY_SALT, KEY_LENGTH);
}

/** Encrypt a plaintext provider token. Returns ciphertext + IV + auth tag. */
export function encryptToken(plaintext: string): EncryptedToken {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt a previously-encrypted provider token.
 * Throws if the ciphertext, IV, or auth tag has been tampered with, or if the
 * key (SESSION_SECRET) no longer matches what was used to encrypt.
 */
export function decryptToken(payload: EncryptedToken): string {
  const key = getKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
