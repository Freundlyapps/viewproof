import { env } from 'cloudflare:test';
import type { Deps } from '../src/app';
import { parseConfig } from '../src/env';
import { fakeGoogle } from './fake-google';

export const APP = 'http://localhost:8787';
export function makeDeps(over: Partial<Deps> = {}, envOver: Partial<typeof env> = {}): Deps {
  return { db: env.DB, config: parseConfig({ ...env, ...envOver }), google: fakeGoogle(), now: () => Date.now(), ...over };
}
export async function addUser(id: string, plan = 'free') {
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, plan, created_at) VALUES (?, ?, ?, ?, ?, '2026-11-21T00:00:00Z')")
    .bind(id, `sub-${id}`, `${id}@example.com`, `User ${id}`, plan).run();
}
/** Cookie header value from a Set-Cookie response. */
export function cookieFrom(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}
