import type { ReactNode } from 'react';
import { useState } from 'react';
import { NavLink } from 'react-router';
import type { ChannelInfo, Me } from '../api';
import { type Theme, applyTheme, initialTheme } from '../theme';
import { NAV } from './nav';

export function Shell(props: { me: Me; channels: ChannelInfo[]; current: ChannelInfo | null; onSwitch: (id: string) => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const t = initialTheme();
    applyTheme(t);
    return t;
  });
  const flip = () => {
    const t: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(t, true);
    setTheme(t);
  };
  const { current } = props;
  return (
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <aside className="side">
        <div className="brand"><div className="logo">VP</div><span>ViewProof</span></div>
        <nav aria-label="Main">
          {NAV.map((n, i) =>
            n === '-' ? <div className="sep" key={`sep${i}`} /> : (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} data-label={n.label} className={({ isActive }) => `nav${isActive ? ' on' : ''}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={n.icon} /></svg>
                <span className="lbl">{n.label}</span>
                {n.soon ? <span className="later lbl">soon</span> : null}
              </NavLink>
            ))}
        </nav>
        <div className="grow" />
        <button type="button" className="nav" onClick={() => setCollapsed(!collapsed)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} /></svg>
          <span className="lbl">Collapse</span>
        </button>
      </aside>
      <div className="main">
        <header className="top">
          <div style={{ flex: 1 }} />
          <button type="button" className="icon-btn" aria-label="Switch light / dark" title="Switch light / dark" onClick={flip}>◐</button>
          {props.channels.length > 0 ? (
            <label className="chan">
              {current?.avatarUrl ? <img className="av" src={current.avatarUrl} alt="" /> : <span className="av" />}
              <select aria-label="Channel" value={current?.id ?? ''} onChange={(e) => props.onSwitch(e.target.value)}>
                {props.channels.map((c) => <option key={c.id} value={c.id}>{c.title ?? c.channelId}</option>)}
              </select>
            </label>
          ) : null}
        </header>
        <main className="content">
          {current && current.status !== 'active' ? (
            <div className="banner" role="status" style={{ marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <b>{current.status === 'reconnect' ? 'Reconnect needed' : 'Channel no longer exists'}</b>
                <div className="small muted">{current.statusReason ?? (current.status === 'gone' ? 'YouTube no longer returns this channel.' : '')}</div>
              </div>
              {current.status === 'reconnect'
                ? <a className="btn pri" href="/auth/google/start?choose=1">Reconnect</a>
                : <a className="btn" href="/account">Remove it</a>}
            </div>
          ) : null}
          {props.children}
        </main>
      </div>
    </div>
  );
}
