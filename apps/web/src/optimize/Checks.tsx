import type { OptimizeCheck } from '@viewproof/core';

const MARK = { pass: '✓', fail: '✗', skip: '–' } as const;
const WORD = { pass: 'Pass', fail: 'Fail', skip: 'Skipped' } as const;

/** Rule-based checks: each row shows the rule (with its threshold) and what was found. */
export function Checks(props: { label: string; checks: OptimizeCheck[] }) {
  return (
    <ul className="checks" aria-label={props.label}>
      {props.checks.map((c) => (
        <li key={c.id} className={`check ${c.status}`}>
          <span className="mark" aria-hidden="true">{MARK[c.status]}</span>
          <span className="sr-only">{WORD[c.status]}</span>
          <span className="rule">{c.rule}</span>
          <span className="detail muted small">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}
