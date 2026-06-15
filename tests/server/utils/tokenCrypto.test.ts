import { describe, it, expect, beforeEach } from 'vitest';
import { encryptToken, decryptToken } from '~/server/utils/tokenCrypto';

describe('tokenCrypto (AES-256-GCM)', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-unit-tests-at-least-32-chars';
  });

  it('round-trips a token through encrypt/decrypt', () => {
    const plaintext = 'ya29.a0Af-some-provider-access-token';
    const enc = encryptToken(plaintext);
    expect(decryptToken(enc)).toBe(plaintext);
  });

  it('produces ciphertext-only output (no plaintext leakage) with iv + authTag', () => {
    const plaintext = 'sensitive-bearer-token';
    const enc = encryptToken(plaintext);
    expect(enc.ciphertext).not.toContain(plaintext);
    expect(enc.iv).toBeTruthy();
    expect(enc.authTag).toBeTruthy();
    // Base64 fields decode to non-empty buffers.
    expect(Buffer.from(enc.iv, 'base64').length).toBe(12);
    expect(Buffer.from(enc.authTag, 'base64').length).toBe(16);
  });

  it('uses a fresh IV each call (different ciphertext for same plaintext)', () => {
    const a = encryptToken('same-token');
    const b = encryptToken('same-token');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    // Both still decrypt back to the original.
    expect(decryptToken(a)).toBe('same-token');
    expect(decryptToken(b)).toBe('same-token');
  });

  it('fails to decrypt when the ciphertext is tampered with', () => {
    const enc = encryptToken('original-token');
    const tampered = { ...enc, ciphertext: Buffer.from('garbage-bytes').toString('base64') };
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('fails to decrypt when the auth tag is tampered with', () => {
    const enc = encryptToken('original-token');
    const flipped = Buffer.from(enc.authTag, 'base64');
    flipped[0] = flipped[0] ^ 0xff;
    const tampered = { ...enc, authTag: flipped.toString('base64') };
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('fails to decrypt when the key (SESSION_SECRET) differs from encrypt time', () => {
    const enc = encryptToken('original-token');
    process.env.SESSION_SECRET = 'a-completely-different-secret-thats-32-chars!';
    expect(() => decryptToken(enc)).toThrow();
  });

  it('throws when SESSION_SECRET is missing', () => {
    delete process.env.SESSION_SECRET;
    expect(() => encryptToken('x')).toThrow(/SESSION_SECRET/);
  });
});
