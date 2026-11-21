import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { decryptSecret, encryptSecret, pkcePair, randomToken, sha256Hex } from '../src/crypto';

const KEY = env.TOKEN_KEY;
const OTHER = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe('secrets', () => {
  test('round trip', async () => {
    const box = await encryptSecret('1//refresh-token', KEY);
    expect(box.startsWith('v1.')).toBe(true);
    expect(await decryptSecret(box, KEY)).toBe('1//refresh-token');
  });
  test('same text encrypts differently each time', async () => {
    expect(await encryptSecret('x', KEY)).not.toBe(await encryptSecret('x', KEY));
  });
  test('tampering is detected', async () => {
    const box = await encryptSecret('secret', KEY);
    const last = box.at(-2) === 'A' ? 'B' : 'A';
    await expect(decryptSecret(box.slice(0, -2) + last + box.at(-1), KEY)).rejects.toThrow();
  });
  test('wrong key fails', async () => {
    await expect(decryptSecret(await encryptSecret('secret', KEY), OTHER)).rejects.toThrow();
  });
  test('key must be 32 bytes', async () => {
    await expect(encryptSecret('x', btoa('short'))).rejects.toThrow('TOKEN_KEY must be 32 bytes');
  });
});

describe('hashing and tokens', () => {
  test('sha256Hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test('randomToken is 43 base64url chars by default and unique', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  test('PKCE challenge is base64url(sha256(verifier)) without padding', async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });
});
