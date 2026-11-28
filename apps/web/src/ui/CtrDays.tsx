import { fmt } from './format';

/** YouTube's click-through rate per day as given: one bar per day, the value on hover. */
export function CtrDays(props: { days: { date: string; ctr: number }[]; height?: number }) {
  const { days } = props;
  if (!days.length) return <span className="muted small">–</span>;
  const max = Math.max(...days.map((d) => d.ctr), 0.0001);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: props.height ?? 28, minWidth: 60 }} role="img" aria-label={`Click-through rate per day: ${days.map((d) => `${d.date} ${fmt.pct(d.ctr)}`).join(', ')}`}>
      {days.map((d) => <div key={d.date} title={`${d.date}: ${fmt.pct(d.ctr)}`} style={{ flex: 1, height: `${(d.ctr / max) * 100}%`, minHeight: 2, background: 'var(--hi)', borderRadius: '2px 2px 0 0', opacity: 0.8 }} />)}
    </div>
  );
}
