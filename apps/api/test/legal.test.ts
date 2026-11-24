// Plan 8: what Google's OAuth verification and the closed beta need: public privacy and terms pages.
import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { runCron } from '../src/competitors/cron';
import { addUser, makeDeps, readText } from './helpers';

const OPERATOR = { CONTACT_EMAIL: 'privacy@viewproof.example', OPERATOR_NAME: 'Example Operator' };

describe('privacy and terms pages', () => {
  test('privacy: public, with the Limited Use statement, what is stored and how to revoke', async () => {
    const res = await createApp(makeDeps({}, OPERATOR)).request('/privacy');
    expect(res.status).toBe(200);
    const html = await readText(res);
    expect(html).toContain('Privacy policy');
    expect(html).toContain("ViewProof's use and transfer of information received from Google APIs to any other app will adhere to");
    expect(html).toContain('href="https://developers.google.com/terms/api-services-user-data-policy"');
    expect(html).toContain('including the Limited Use requirements');
    expect(html).toContain('href="https://security.google.com/settings/security/permissions"');
    expect(html).toContain('encrypted');
    expect(html).toContain('Example Operator');
    expect(html).toContain('href="mailto:privacy@viewproof.example"');
    expect(html).toContain('href="https://www.youtube.com/t/terms"');
    expect(html).toContain('href="https://policies.google.com/privacy"');
  });

  test('without an operator contact the pages still render and say so', async () => {
    const html = await readText(await createApp(makeDeps()).request('/privacy'));
    expect(html).toContain("The operator of this server hasn't set a contact address.");
    expect(html).not.toContain('mailto:');
  });

  test('terms: public, read-only access, the YouTube Terms of Service, and plan rules', async () => {
    const res = await createApp(makeDeps({}, OPERATOR)).request('/terms');
    expect(res.status).toBe(200);
    const html = await readText(res);
    expect(html).toContain('Terms of service');
    expect(html).toContain('By using ViewProof you agree to be bound by the');
    expect(html).toContain('href="https://www.youtube.com/t/terms"');
    expect(html).toContain('href="mailto:privacy@viewproof.example"');
  });

  test('the home page links to both', async () => {
    const html = await readText(await createApp(makeDeps()).request('/'));
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  test('the hourly job deletes outlier search words older than yesterday (only today counts toward the limit)', async () => {
    await addUser('lg-o1');
    await env.DB.prepare("INSERT INTO outlier_searches (user_id, day, query) VALUES ('lg-o1', '2026-11-21', 'old'), ('lg-o1', '2026-11-22', 'yesterday'), ('lg-o1', '2026-11-23', 'today')").run();
    const at = Date.parse('2026-11-23T10:00:00Z');
    await runCron(makeDeps({ now: () => at }), new Date(at));
    const left = await env.DB.prepare("SELECT query FROM outlier_searches WHERE user_id = 'lg-o1' ORDER BY day").all<{ query: string }>();
    expect(left.results.map((r) => r.query)).toEqual(['yesterday', 'today']);
  }, 60_000);
});
