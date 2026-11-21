import type { ApiError } from '@viewproof/core';

export function ErrorNote(props: { error: ApiError }) {
  const { error } = props;
  if (error.error === 'reconnect' || error.error === 'gone') return <p className="empty">{error.message}</p>;
  return <p className="empty">Couldn't load this from YouTube: {error.message}</p>;
}
