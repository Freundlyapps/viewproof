import type { ReactNode } from 'react';

/** Provenance label (spec §15): REAL teal, ESTIMATE amber, AI dashed. */
export function Badge(props: { kind: 'real' | 'est' | 'ai'; children?: ReactNode }) {
  const text = props.children ?? (props.kind === 'real' ? 'REAL' : props.kind === 'est' ? 'ESTIMATE' : 'AI');
  return <span className={`badge b-${props.kind}`}>{text}</span>;
}
