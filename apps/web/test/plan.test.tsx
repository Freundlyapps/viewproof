import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { ME, channel, mockApi } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const rows = (plan: 'free' | 'pro') => plan === 'free'
  ? [
      { key: 'channels', label: 'Connected channels', used: 1, limit: 1, per: 'total' },
      { key: 'competitors', label: 'Competitor channels', used: 2, limit: 3, per: 'total' },
      { key: 'keywordLookups', label: 'New keyword lookups', used: 4, limit: 5, per: 'month' },
      { key: 'outlierSearches', label: 'Outlier searches', used: 3, limit: 10, per: 'day' },
      { key: 'aiQuick', label: 'AI quick actions', used: 7, limit: 20, per: 'month' },
      { key: 'aiCoach', label: 'Ask AI messages', used: 0, limit: 0, per: 'month' },
    ]
  : [{ key: 'outlierSearches', label: 'Outlier searches', used: 30, limit: null, per: 'day' }];
const billing = (over: Record<string, unknown> = {}) => {
  const plan = (over.plan as 'free' | 'pro') ?? 'free';
  return { enabled: true, plan, status: null, periodEnd: null, cancelAt: null, usage: { plan, month: '2026-11', resetsOn: '2026-12-01', rows: rows(plan) }, ...over };
};
const base = { '/api/me': ME, '/api/channels': [channel()] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Settings → Plan & usage', () => {
  test('free: meters with limits and period, the reset date, and Upgrade goes to Stripe', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const posted: string[] = [];
    mockApi({ ...base, '/api/billing': (u: URL, init?: RequestInit) => {
      if (init?.method === 'POST') { posted.push(u.pathname); return { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }; }
      return billing();
    } });
    renderAt('/settings/plan');
    expect(await screen.findByText('New keyword lookups: 4 of 5 this month')).toBeTruthy();
    expect(screen.getByText('Outlier searches: 3 of 10 today')).toBeTruthy();
    expect(screen.getByText('Competitor channels: 2 of 3')).toBeTruthy();
    expect(screen.getByText('Ask AI messages: Pro only')).toBeTruthy();
    expect(screen.getByText(/resets 1 Dec/)).toBeTruthy();
    expect(screen.getByText('When you hit a limit, we tell you. You can add your own AI key to keep going. No surprise charges.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro — $10/month' }));
    expect(posted).toEqual(['/api/billing/checkout']);
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1');
  });

  test('pro: renews date, portal button, one-click cancel then resume', async () => {
    let cancelAt: string | null = null;
    const posted: string[] = [];
    mockApi({ ...base, '/api/billing': (u: URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(u.pathname);
        if (u.pathname.endsWith('/cancel')) cancelAt = '2026-12-21T12:00:00.000Z';
        if (u.pathname.endsWith('/resume')) cancelAt = null;
      }
      return billing({ plan: 'pro', status: 'active', periodEnd: '2026-12-21T12:00:00.000Z', cancelAt });
    } });
    renderAt('/settings/plan');
    expect(await screen.findByText('Pro · renews 21 Dec 2026')).toBeTruthy();
    expect(screen.getByText('Outlier searches: 30 today (no limit)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invoices & payment' })).toBeTruthy();
    expect(screen.getByText('One click. You keep Pro until 21 Dec 2026.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));
    expect(await screen.findByText('Pro until 21 Dec 2026 · cancelled')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Resume Pro' }));
    expect(await screen.findByText('Pro · renews 21 Dec 2026')).toBeTruthy();
    expect(posted).toEqual(['/api/billing/cancel', '/api/billing/resume']);
  });

  test('past_due shows the card callout', async () => {
    mockApi({ ...base, '/api/billing': billing({ plan: 'pro', status: 'past_due', periodEnd: '2026-12-21T12:00:00.000Z' }) });
    renderAt('/settings/plan');
    expect(await screen.findByText('Payment failed — update your card in Invoices & payment.')).toBeTruthy();
  });

  test('billing off: plan and usage, no buttons', async () => {
    mockApi({ ...base, '/api/billing': billing({ enabled: false }) });
    renderAt('/settings/plan');
    expect(await screen.findByText("Billing isn't set up on this server.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel plan' })).toBeNull();
    // No plan prices or limits that don't apply on this server.
    expect(screen.queryByText(/\$10\/month/)).toBeNull();
  });

  test('back from Checkout with a session id: confirms it and shows Pro without waiting for the webhook', async () => {
    const bodies: unknown[] = [];
    mockApi({ ...base, '/api/billing': (u: URL, init?: RequestInit) => {
      if (init?.method === 'POST' && u.pathname === '/api/billing/confirm') {
        bodies.push(JSON.parse(String(init.body)));
        return billing({ plan: 'pro', status: 'active', periodEnd: '2026-12-21T12:00:00.000Z' });
      }
      return billing();
    } });
    renderAt('/settings/plan?checkout=done&session_id=cs_test_abc');
    expect(await screen.findByText('Pro · renews 21 Dec 2026')).toBeTruthy();
    expect(bodies).toEqual([{ sessionId: 'cs_test_abc' }]);
    expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull();
  });

  test('back from checkout without a session id: claims no payment, checks again, then says so plainly', async () => {
    mockApi({ ...base, '/api/billing': billing() });
    renderAt('/settings/plan?checkout=done');
    expect(await screen.findByText('Waiting for Stripe to confirm your payment…')).toBeTruthy();
    expect(screen.queryByText(/Payment received/)).toBeNull();
    expect(await screen.findByText("Stripe hasn't confirmed a payment yet. If you paid, it can take a minute; reload this page.", {}, { timeout: 5000 })).toBeTruthy();
  }, 10_000);

  test('unpaid: explains why Pro is off and offers the invoice page, not a second subscription', async () => {
    mockApi({ ...base, '/api/billing': billing({ plan: 'free', status: 'unpaid', periodEnd: '2026-12-21T12:00:00.000Z' }) });
    renderAt('/settings/plan');
    expect(await screen.findByText('Your payments failed, so Pro is off. Pay the open invoice in Invoices & payment to turn it back on.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invoices & payment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull();
  });

  test('a server error on upgrade shows its message', async () => {
    mockApi({ ...base, '/api/billing': (_u: URL, init?: RequestInit) => init?.method === 'POST' ? json({ error: 'stripe_failed', message: 'No such price: price_x' }, 502) : billing() });
    renderAt('/settings/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro — $10/month' }));
    expect(await screen.findByText('No such price: price_x')).toBeTruthy();
  });

  test('the Settings overview links to Plan & usage', async () => {
    mockApi({ ...base });
    renderAt('/settings');
    const card = (await screen.findByRole('heading', { name: 'Plan & usage' })).closest('.card') as HTMLElement;
    expect(within(card).getByRole('link', { name: 'Plan & usage' }).getAttribute('href')).toBe('/settings/plan');
  });
});
