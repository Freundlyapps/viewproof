const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Random, URL-safe token (session ids, OAuth state). 32 bytes → 43 characters. */
export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PKCE (RFC 7636) S256 pair. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
  return { verifier, challenge };
}

async function aesKey(keyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM with a random 12-byte IV. Format: "v1.<iv>.<ciphertext+tag>" (base64url). */
export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), enc.encode(plain)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

/** Throws on a wrong key, an unknown format or any tampering. */
export async function decryptSecret(box: string, keyB64: string): Promise<string> {
  const [v, iv, ct] = box.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('unknown secret format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(keyB64), fromB64url(ct));
  return dec.decode(plain);
}

/** Per-user key (D7): HKDF-SHA256 from TOKEN_KEY, so one user's box never opens for another. */
async function userKey(userId: string, keyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes (base64)');
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(`viewproof ai-key ${userId}`) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Format: "u1.<iv>.<ciphertext+tag>" (base64url). */
export async function encryptForUser(plain: string, userId: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await userKey(userId, keyB64), enc.encode(plain)));
  return `u1.${b64url(iv)}.${b64url(ct)}`;
}

/** Throws for another user's box, a wrong key, an unknown format or tampering. */
export async function decryptForUser(box: string, userId: string, keyB64: string): Promise<string> {
  const [v, iv, ct] = box.split('.');
  if (v !== 'u1' || !iv || !ct) throw new Error('unknown secret format');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await userKey(userId, keyB64), fromB64url(ct)));
}
