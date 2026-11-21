import type { ApiError } from '@viewproof/core';

export function ErrorNote(props: { error: ApiError }) {
  const { error } = props;
  if (error.error === 'reconnect') {
    return <div className="banner"><span style={{ flex: 1 }}>{error.message}</span><a className="btn pri" href="/auth/google/start?choose=1">Reconnect</a></div>;
  }
  if (error.error === 'gone') {
    return <div className="banner"><span style={{ flex: 1 }}>{error.message}</span><a className="btn" href="/account">Remove it</a></div>;
  }
  return <p className="empty">Couldn't load this from YouTube: {error.message}</p>;
}
