import { RANGES, type RangeKey, parseRange } from '@viewproof/core';
import { useSearchParams } from 'react-router';
import { RANGE_LABEL } from '../ui/format';

export function useRange(): [RangeKey, (r: RangeKey) => void] {
  const [params, setParams] = useSearchParams();
  const range = parseRange(params.get('range') ?? undefined);
  return [range, (r) => setParams((p) => { p.set('range', r); return p; })];
}

export function RangeChips() {
  const [range, setRange] = useRange();
  return (
    <div className="row" role="group" aria-label="Date range">
      {RANGES.map((r) => (
        <button type="button" key={r} className={`chip${r === range ? ' on' : ''}`} aria-pressed={r === range} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>
      ))}
    </div>
  );
}
