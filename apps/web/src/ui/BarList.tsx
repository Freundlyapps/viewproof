export interface Bar { key: string; label: string; value: number; right: string }

/**
 * Horizontal bars of YouTube's own numbers. Bar length only draws the number against the biggest one in the list
 * (like any chart); no share or percentage is shown (YouTube policy III.E.4.h).
 */
export function BarList(props: { items: Bar[]; testId?: string }) {
  const max = Math.max(1, ...props.items.map((b) => b.value));
  return (
    <div className="bars" data-testid={props.testId}>
      {props.items.map((b) => (
        <div className="bar-row" key={b.key}>
          <div className="row between small"><span className="bar-label">{b.label}</span><span className="muted">{b.right}</span></div>
          <div className="bar-track" aria-hidden="true"><i style={{ width: `${Math.max(0.5, (b.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
