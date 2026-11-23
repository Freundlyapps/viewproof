import { clock, transcriptText } from '@viewproof/core';
import { useEffect, useState } from 'react';
import { listTranscripts, type StoredTranscript } from '../research/extension';
import { NEEDS_EXTENSION } from './Tools';

/** Transcript viewer: transcripts the extension read when the user opened YouTube's transcript panel. */
export function TranscriptTool() {
  const [items, setItems] = useState<StoredTranscript[] | null | 'loading'>('loading');
  const [open, setOpen] = useState<StoredTranscript | null>(null);
  const [find, setFind] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { void listTranscripts().then(setItems); }, []);

  if (items === 'loading') return <div className="card"><p className="empty">Asking the extension…</p></div>;
  if (items === null) return <div className="card"><p className="nodata">{NEEDS_EXTENSION}</p></div>;

  const how = <p className="note">On a YouTube video, open the description and click <strong>Show transcript</strong>. The extension keeps that transcript in this browser only (the 20 newest, for 30 days); nothing is uploaded.</p>;

  if (open) {
    const q = find.trim().toLowerCase();
    const shown = q ? open.segments.filter((s) => s.text.toLowerCase().includes(q)) : open.segments;
    const download = () => {
      const url = URL.createObjectURL(new Blob([transcriptText(open.segments, true)], { type: 'text/plain' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `${open.videoId}-transcript.txt` });
      a.click();
      URL.revokeObjectURL(url);
    };
    return (
      <div className="card stack">
        <div className="row between">
          <h2>{open.title}</h2>
          <button type="button" className="btn" onClick={() => { setOpen(null); setFind(''); }}>All transcripts</button>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => void navigator.clipboard.writeText(transcriptText(open.segments, false)).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy text'}</button>
          <button type="button" className="btn" onClick={download}>Download .txt</button>
        </div>
        <div className="field"><label htmlFor="tr-find">Find in transcript</label><input id="tr-find" className="input" value={find} onChange={(e) => setFind(e.target.value)} /></div>
        {q && <p className="muted small">{shown.length} of {open.segments.length} lines</p>}
        <ul className="lines">
          {shown.map((s, i) => (
            <li key={`${s.startSec}-${i}`}>
              <a href={`https://www.youtube.com/watch?v=${open.videoId}&t=${s.startSec}s`} target="_blank" rel="noreferrer" className="muted">{clock(s.startSec)}</a>{' '}
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="card stack">
      {items.length === 0 ? <p className="empty">No transcripts yet.</p> : (
        <ul className="lines" aria-label="Transcripts in this browser">
          {items.map((t) => (
            <li key={t.videoId}>
              <button type="button" className="btn" onClick={() => { setOpen(t); setCopied(false); }}>{t.title || t.videoId}</button>
              <span className="muted small"> {t.segments.length} lines · read {new Date(t.savedAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
      {how}
    </div>
  );
}
