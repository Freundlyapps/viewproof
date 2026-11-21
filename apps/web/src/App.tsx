import { type ReactElement, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';
import { type ChannelInfo, type Me, getJson, isApiError } from './api';
import { Settings } from './Settings';
import { NAV } from './shell/nav';
import { NoChannel } from './shell/NoChannel';
import { Shell } from './shell/Shell';
import { SignIn } from './shell/SignIn';
import { Soon } from './shell/Soon';
import { HomePage } from './home/Home';
import { MyChannel } from './channel/MyChannel';

const CHANNEL_KEY = 'vp-channel';
type State = { kind: 'loading' } | { kind: 'signed_out' } | { kind: 'error'; message: string } | { kind: 'ready'; me: Me; channels: ChannelInfo[] };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [currentId, setCurrentId] = useState<string | null>(() => localStorage.getItem(CHANNEL_KEY));

  useEffect(() => {
    let live = true;
    void Promise.all([getJson<Me>('/api/me'), getJson<ChannelInfo[]>('/api/channels')]).then(([me, channels]) => {
      if (!live) return;
      if (isApiError(me) || isApiError(channels)) {
        const e = isApiError(me) ? me : (channels as { error: string; message: string });
        setState(e.error === 'signed_out' ? { kind: 'signed_out' } : { kind: 'error', message: e.message });
      } else setState({ kind: 'ready', me, channels });
    });
    return () => { live = false; };
  }, []);

  if (state.kind === 'loading') return <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  if (state.kind === 'signed_out') return <SignIn />;
  if (state.kind === 'error') return <p style={{ padding: 24 }}>Couldn't load your account: {state.message}</p>;

  const current = state.channels.find((c) => c.id === currentId) ?? state.channels[0] ?? null;
  const onSwitch = (id: string) => {
    localStorage.setItem(CHANNEL_KEY, id);
    setCurrentId(id);
  };
  const needsChannel = (el: ReactElement) => (current ? el : <NoChannel />);
  return (
    <Shell me={state.me} channels={state.channels} current={current} onSwitch={onSwitch}>
      <Routes>
        <Route path="/" element={needsChannel(<HomePage channel={current!} />)} />
        <Route path="/channel/:tab?" element={needsChannel(<MyChannel channel={current!} />)} />
        <Route path="/settings/*" element={<Settings />} />
        {NAV.flatMap((n) => (n !== '-' && n.soon ? [<Route key={n.to} path={`${n.to}/*`} element={<Soon title={n.label} text={n.soon} />} />] : []))}
        <Route path="*" element={<Soon title="Not found" text="This page doesn't exist." />} />
      </Routes>
    </Shell>
  );
}
