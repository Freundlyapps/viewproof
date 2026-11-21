import type { Measured } from '@viewproof/core';

/** A measured number, or "No data: <reason>" — never a stand-in value. */
export function Value(props: { m: Measured<number>; format: (n: number) => string }) {
  const { m } = props;
  if (m.kind === 'no_data') return <span className="nodata" data-testid="value">No data: {m.reason}</span>;
  return <span data-testid="value" title={`Source: ${m.formula}`}>{props.format(m.value)}</span>;
}
