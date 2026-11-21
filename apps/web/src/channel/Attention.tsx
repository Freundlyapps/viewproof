import type { AttentionItem } from '@viewproof/core';

export function Attention(props: { items: AttentionItem[] }) {
  return (
    <div>
      {props.items.map((it) => (
        <div className="check" key={it.title}>
          <div className={`dot ${it.level === 'ok' ? 'ok' : 'no'}`} style={it.level === 'info' ? { background: 'var(--muted)' } : undefined}>{it.level === 'ok' ? '✓' : it.level === 'warn' ? '!' : 'i'}</div>
          <div style={{ flex: 1 }}><b>{it.title}</b><div className="small muted">{it.detail}</div></div>
          {it.action ? <a className="btn" href={it.action.href}>{it.action.label}</a> : null}
        </div>
      ))}
    </div>
  );
}
