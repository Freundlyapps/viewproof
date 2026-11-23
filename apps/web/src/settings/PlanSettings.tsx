import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { isApiError, sendJson } from '../api';
import { useApi } from '../useApi';

interface UsageRow { key: string; label: string; used: number; limit: number | null; per: 'total' | 'month' | 'day' }
export interface Billing {
  enabled: boolean; plan: string; status: string | null; periodEnd: string | null; cancelAt: string | null;
  usage: { plan: string; month: string; resetsOn: string; rows: UsageRow[] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "21 Dec 2026" (UTC, same wording everywhere); withYear false → "1 Dec". */
export function dayMonth(iso: string, withYear = true): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
}
const PER = { total: '', month: ' this month', day: ' today' } as const;

function Meter(props: { r: UsageRow }) {
  const { r } = props;
  if (r.limit === null) return <p className="small">{r.label}: {r.used}{PER[r.per]} (no limit)</p>;
  if (r.limit === 0) return <p className="small">{r.label}: Pro only</p>;
  const pct = Math.min(100, (r.used / r.limit) * 100);
  return (
    <div className="stack-s">
      <p className="small">{r.label}: {r.used} of {r.limit}{PER[r.per]}</p>
      <div className={`meter${pct >= 80 ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function PlanCard(props: { b: Billing; onChange: (b: Billing) => void }) {
  const { b } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pro = b.plan === 'pro';
  const go = async (path: 'checkout' | 'portal') => {
    setBusy(true);
    setError(null);
    const r = await sendJson<{ url: string }>('POST', `/api/billing/${path}`);
    setBusy(false);
    if (isApiError(r)) return setError(r.message ?? r.error);
    if (r) window.location.assign(r.url);
  };
  const change = async (path: 'cancel' | 'resume') => {
    setBusy(true);
    setError(null);
    const r = await sendJson<Billing>('POST', `/api/billing/${path}`);
    setBusy(false);
    if (isApiError(r)) return setError(r.message ?? r.error);
    if (r) props.onChange(r);
  };
  const end = b.cancelAt ?? b.periodEnd;
  return (
    <div className="card stack">
      <h2>Your plan</h2>
      {b.enabled && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="plan-box"><div><b>Free</b>{!pro && <> <span className="badge b-real">your plan</span></>}<div className="small muted">1 channel, 3 competitors, 5 keyword lookups and 20 AI quick actions a month.</div></div></div>
        <div className="plan-box"><div><b>Pro · $10/month</b>{pro && <> <span className="badge b-real">your plan</span></>}<div className="small muted">3 channels, 25 competitors, 60 keyword lookups, 500 AI quick actions and 150 Ask AI messages a month.</div></div></div>
      </div>}
      {pro && (b.cancelAt
        ? <p><b>Pro until {dayMonth(b.cancelAt)} · cancelled</b></p>
        : b.periodEnd ? <p><b>Pro · renews {dayMonth(b.periodEnd)}</b></p> : <p><b>Pro</b></p>)}
      {b.status === 'past_due' && <p className="callout">Payment failed — update your card in Invoices &amp; payment.</p>}
      {!b.enabled
        ? <p className="small muted">Billing isn't set up on this server.</p>
        : pro
          ? (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn" disabled={busy} onClick={() => void go('portal')}>Invoices &amp; payment</button>
              {b.cancelAt
                ? <button type="button" className="btn pri" disabled={busy} onClick={() => void change('resume')}>Resume Pro</button>
                : <>
                    <button type="button" className="btn" style={{ color: 'var(--neg)' }} disabled={busy} onClick={() => void change('cancel')}>Cancel plan</button>
                    {end && <span className="small muted">One click. You keep Pro until {dayMonth(end)}.</span>}
                  </>}
            </div>
            )
          : <div><button type="button" className="btn pri" disabled={busy} onClick={() => void go('checkout')}>Upgrade to Pro — $10/month</button></div>}
      {b.enabled && <p className="small muted">Payments, tax and receipts are handled by Stripe. Stripe emails you before each renewal.</p>}
      {error && <p className="err-text small">{error}</p>}
    </div>
  );
}

/** Settings → Plan & usage (plan 7, spec §8 item 8, §9): every limit as a counter; upgrade, invoices and one-click cancel. */
export function PlanSettings() {
  const [params] = useSearchParams();
  const back = params.get('checkout') === 'done';
  const sessionId = params.get('session_id');
  const [version, setVersion] = useState(0);
  const r = useApi<Billing>(`/api/billing${version ? `?v=${version}` : ''}`);
  const [override, setOverride] = useState<Billing | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Back from Stripe: confirm the checkout session now rather than wait for the webhook; without an id, look again later.
  useEffect(() => {
    if (!back) return undefined;
    if (sessionId) {
      let live = true;
      void sendJson<Billing>('POST', '/api/billing/confirm', { sessionId }).then((x) => {
        if (!live) return;
        if (isApiError(x)) setConfirmError(x.message ?? x.error);
        else if (x) setOverride(x);
      });
      return () => { live = false; };
    }
    const t = setTimeout(() => setVersion(1), 3000);
    return () => clearTimeout(t);
  }, [back, sessionId]);
  const b = override ?? (r.state === 'ok' ? r.data : null);
  return (
    <section className="screen">
      <div><h1>Plan &amp; usage</h1></div>
      {r.state === 'error' && !override && <p className="err-text">{r.error.message}</p>}
      {!b && r.state === 'loading' && <p className="muted">Loading…</p>}
      {b && (
        <>
          {back && b.plan !== 'pro' && <p className="callout">Payment received. Pro turns on as soon as Stripe confirms it.</p>}
          {confirmError && <p className="err-text small">{confirmError}</p>}
          <div className="grid g-2">
            <div className="card stack">
              <h2>This month <span className="small muted" style={{ fontWeight: 400 }}>resets {dayMonth(b.usage.resetsOn, false)}</span></h2>
              {b.usage.rows.map((x) => <Meter key={x.key} r={x} />)}
              <p className="note">When you hit a limit, we tell you. You can add your own AI key to keep going. No surprise charges.</p>
            </div>
            <PlanCard b={b} onChange={setOverride} />
          </div>
        </>
      )}
    </section>
  );
}
