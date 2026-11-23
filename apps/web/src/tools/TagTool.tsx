import { tagChars, TAGS_LIMIT, videoIdFromInput } from '@viewproof/core';
import { useState } from 'react';
import { lookupVideo, type VideoFacts } from '../research/extension';
import { NEEDS_EXTENSION } from './Tools';

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; text: string } | { kind: 'done'; video: VideoFacts };

/** Tag extractor: any public video's tags, read by the extension from YouTube's own page. */
export function TagTool(props: { onChapters: (v: { description: string; lengthSeconds: number }) => void }) {
  const [input, setInput] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const id = videoIdFromInput(input);
    if (!id) { setState({ kind: 'error', text: "That isn't a YouTube video link." }); return; }
    setState({ kind: 'busy' });
    setCopied(false);
    const r = await lookupVideo(id);
    if (!r) setState({ kind: 'error', text: NEEDS_EXTENSION });
    else setState(r.ok ? { kind: 'done', video: r.video } : { kind: 'error', text: r.reason });
  }

  return (
    <div className="card stack">
      <form className="stack-s" onSubmit={(e) => void run(e)}>
        <div className="field">
          <label htmlFor="tag-input">YouTube video link or id</label>
          <input id="tag-input" className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
        </div>
        <div><button type="submit" className="btn pri" disabled={state.kind === 'busy'}>{state.kind === 'busy' ? 'Reading…' : 'Get tags'}</button></div>
      </form>
      {state.kind === 'error' && <p className="nodata">{state.text}</p>}
      {state.kind === 'done' && (
        <div className="stack-s">
          <h2>{state.video.title}</h2>
          {state.video.tags.length === 0 ? <p className="nodata">This video has no tags.</p> : (
            <>
              <ul className="tags-list" aria-label={`Tags of ${state.video.title}`}>
                {state.video.tags.map((t) => <li key={t} className="tag">{t}</li>)}
              </ul>
              <p className="muted small">{state.video.tags.length} tag{state.video.tags.length === 1 ? '' : 's'} · {tagChars(state.video.tags)} of {TAGS_LIMIT} characters</p>
            </>
          )}
          <div className="row">
            {state.video.tags.length > 0 && (
              <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(state.video.tags.join(', ')).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy tags'}</button>
            )}
            <button type="button" className="btn" onClick={() => props.onChapters({ description: state.video.description, lengthSeconds: state.video.lengthSeconds })}>Check its chapters</button>
          </div>
          <p className="note">Read by your ViewProof extension from the video's public YouTube page, without your YouTube sign-in. At most 30 lookups an hour.</p>
        </div>
      )}
    </div>
  );
}
