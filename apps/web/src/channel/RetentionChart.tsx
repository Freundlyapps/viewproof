import type { RetentionPoint } from '@viewproof/core';
import { fmt } from '../ui/format';

/**
 * Audience retention as YouTube gave it: share still watching (y) along the video (x).
 * A dashed line marks 0:30; the scale goes above 100% only when rewatches push it there.
 */
export function RetentionChart(props: { curve: RetentionPoint[]; durationSec: number | null }) {
  const { curve, durationSec } = props;
  if (curve.length === 0) return null;
  const top = Math.max(1, ...curve.map((p) => p.audienceWatchRatio)) * 1.05;
  const x = (r: number) => r * 1000;
  const y = (v: number) => 240 - (v / top) * 230;
  const pts = curve.map((p) => `${x(p.elapsedRatio).toFixed(1)},${y(p.audienceWatchRatio).toFixed(1)}`).join(' ');
  const at30 = durationSec && durationSec > 30 ? 30 / durationSec : null;
  return (
    <>
      <svg viewBox="0 0 1000 240" preserveAspectRatio="none" style={{ width: '100%', height: 'clamp(160px,18vw,240px)' }} role="img" aria-label="Audience retention: share of viewers still watching along the video">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="1000" y1={y(g * top)} y2={y(g * top)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />)}
        <polygon points={`${x(curve[0]!.elapsedRatio)},240 ${pts} ${x(curve.at(-1)!.elapsedRatio)},240`} fill="var(--accent)" opacity=".12" />
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        {at30 !== null && at30 <= 1 ? <line x1={x(at30)} x2={x(at30)} y1="0" y2="240" stroke="var(--hi)" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div className="row between small muted">
        <span>Start</span>
        {at30 !== null ? <span style={{ color: 'var(--hi)' }}>┆ 0:30</span> : null}
        <span>{durationSec ? `End (${fmt.duration(durationSec)})` : 'End'}</span>
      </div>
    </>
  );
}
