import type { Pair } from '@viewproof/core';
import { Badge } from '../ui/Badge';
import { Value } from '../ui/Value';

/** A YouTube value with the previous period's value beside it (no % change: YouTube policy III.E.4.h). */
export function Kpi(props: { id: string; label: string; pair: Pair; previousLabel: string; format: (n: number) => string; badge?: 'real' | 'est' }) {
  const { pair } = props;
  return (
    <div className="card kpi" data-testid={props.id}>
      <div className="l row between"><span>{props.label}</span><Badge kind={props.badge ?? 'real'} /></div>
      <div className="v"><Value m={pair.current} format={props.format} /></div>
      <div className="small muted">Previous {props.previousLabel}: <PrevValue pair={pair} format={props.format} /></div>
    </div>
  );
}
function PrevValue(props: { pair: Pair; format: (n: number) => string }) {
  const m = props.pair.previous;
  return m.kind === 'value' ? <span title={`Source: ${m.formula}`}>{props.format(m.value)}</span> : <span>No data: {m.reason}</span>;
}
