import type { Pair, RangeKey } from '@viewproof/core';
import { Badge } from '../ui/Badge';
import { RANGE_LABEL } from '../ui/format';
import { Value } from '../ui/Value';

/** A YouTube value with the previous period's value beside it (no % change: YouTube policy III.E.4.h). */
export function Kpi(props: { id: string; label: string; pair: Pair; range: RangeKey; format: (n: number) => string; badge?: 'real' | 'est' }) {
  const { pair } = props;
  return (
    <div className="card kpi" data-testid={props.id}>
      <div className="l row between"><span>{props.label}</span><Badge kind={props.badge ?? 'real'} /></div>
      <div className="v"><Value m={pair.current} format={props.format} /></div>
      <div className="small muted">Previous {RANGE_LABEL[props.range]}: {pair.previous.kind === 'value' ? props.format(pair.previous.value) : 'no data'}</div>
    </div>
  );
}
