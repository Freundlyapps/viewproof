import { clock, parseChapters, parseTimestamp } from '@viewproof/core';
import { useState } from 'react';

/** Chapter checker: YouTube's chapter rules on a pasted description. */
export function ChapterTool(props: { initial: { description: string; lengthSeconds: number } | null }) {
  const [description, setDescription] = useState(props.initial?.description ?? '');
  const [length, setLength] = useState(props.initial?.lengthSeconds ? clock(props.initial.lengthSeconds) : '');
  const lengthSec = length.trim() ? parseTimestamp(length) : 0;
  const result = description.trim() ? parseChapters(description, lengthSec ?? 0) : null;
  return (
    <div className="card stack">
      <div className="field">
        <label htmlFor="ch-desc">Description</label>
        <textarea id="ch-desc" className="input" rows={8} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={'0:00 Intro\n0:45 First step\n…'} />
      </div>
      <div className="field">
        <label htmlFor="ch-len">Video length (optional, e.g. 12:30)</label>
        <input id="ch-len" className="input" value={length} onChange={(e) => setLength(e.target.value)} />
        {lengthSec === null && <p className="nodata small">Write the length as m:ss or h:mm:ss.</p>}
      </div>
      {result && (result.ok ? (
        <div className="stack-s">
          <p>{result.chapters.length} chapters follow YouTube's rules.</p>
          <ul className="lines" aria-label="Chapters">
            {result.chapters.map((c) => <li key={c.startSec}>{`${clock(c.startSec)} ${c.title}`}</li>)}
          </ul>
        </div>
      ) : <p className="nodata">{result.reason}</p>)}
      <p className="note">YouTube's rules: timestamps at the start of lines, the first at 0:00, at least 3, in order, each chapter at least 10 seconds. Without the video's length the last chapter isn't checked.</p>
    </div>
  );
}
