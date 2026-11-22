import { type OptimizeVideo, type Videos, checkDescription, checkTags, checkTitle, termCoverage } from '@viewproof/core';
import { useEffect, useState } from 'react';
import type { ChannelInfo } from '../api';
import { Badge } from '../ui/Badge';
import { useApi } from '../useApi';
import { Checks } from './Checks';
import { Preview } from './Preview';

const splitTags = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);

function Editor(props: { data: OptimizeVideo }) {
  const v = props.data.video;
  const [title, setTitle] = useState(v.title);
  const [description, setDescription] = useState(v.description);
  const [tags, setTags] = useState(v.tags.join(', '));
  const [keyword, setKeyword] = useState(props.data.terms[0]?.term ?? '');
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const tagList = splitTags(tags);
  const coverage = termCoverage(props.data.terms, { title, description, tags: tagList });
  const copyAll = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(`${title}\n\n${description}\n\nTags: ${tagList.join(', ')}`);
      setCopied('yes');
      setTimeout(() => setCopied('no'), 1500);
    } catch {
      setCopied('failed');
    }
  };
  const at = props.data.fetchedAt;
  const mark = (b: boolean) => (b ? '✓' : '—');
  return (
    <div className="stack">
      <div className="stack-s">
        <h3>Search terms for this video {props.data.terms.length > 0 && <Badge kind="real" />}</h3>
        {props.data.terms.length ? (
          <table className="tbl" aria-label="Search terms for this video">
            <thead><tr><th>Term</th><th>Views from search</th><th>Title</th><th>Description</th><th>Tags</th></tr></thead>
            <tbody>
              {coverage.map((t) => (
                <tr key={t.term}><td>{t.term}</td><td>{t.views.toLocaleString('en-US')}</td><td>{mark(t.inTitle)}</td><td>{mark(t.inDescription)}</td><td>{mark(t.inTags)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="nodata small">{props.data.termsNote}</p>}
        <p className="note">YouTube Analytics, {props.data.period.start} to {props.data.period.end}: the top terms people searched before watching this video. Marks update as you edit.</p>
      </div>
      <div className="field"><label htmlFor="vo-keyword">Keyword for this video</label><input id="vo-keyword" className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
      <div className="field"><label htmlFor="vo-title">Title</label><input id="vo-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <Checks label="Title checks for this video" checks={checkTitle(title, keyword)} />
      <Preview title={title} />
      <div className="field"><label htmlFor="vo-desc">Description</label><textarea id="vo-desc" className="input" rows={8} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <Checks label="Description checks" checks={checkDescription(description, keyword, v.durationSec ?? 0)} />
      <div className="field"><label htmlFor="vo-tags">Tags (comma-separated)</label><input id="vo-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      <Checks label="Tag checks" checks={checkTags(tagList)} />
      <div className="row">
        <button type="button" className="btn pri" onClick={() => void copyAll()}>{copied === 'yes' ? 'Copied' : 'Copy all'}</button>
        <a className="btn" href={`https://studio.youtube.com/video/${v.videoId}/edit`} target="_blank" rel="noopener noreferrer">Open in YouTube Studio</a>
      </div>
      {copied === 'failed' && <p className="err-text" role="alert">Couldn't copy. Select the text and copy it yourself.</p>}
      <p className="note">Loaded from YouTube on {at.slice(0, 10)} at {at.slice(11, 16)} UTC (kept up to 6 hours). Nothing is written to YouTube. Paste into YouTube Studio to change the video.</p>
    </div>
  );
}

export function VideoOptimizer(props: { channel: ChannelInfo }) {
  const list = useApi<Videos>(`/api/channels/${props.channel.id}/videos?range=90d`);
  const [videoId, setVideoId] = useState('');
  useEffect(() => setVideoId(''), [props.channel.id]);
  const data = useApi<OptimizeVideo>(videoId ? `/api/channels/${props.channel.id}/optimize/${videoId}` : null);
  return (
    <div className="card stack">
      <h2>Your videos</h2>
      {list.state === 'error' && <p className="err-text">{list.error.message}</p>}
      {list.state === 'ok' && (
        <div className="field">
          <label htmlFor="vo-video">Video</label>
          <select id="vo-video" className="input" value={videoId} onChange={(e) => setVideoId(e.target.value)}>
            <option value="">Choose a video…</option>
            {list.data.videos.map((x) => <option key={x.videoId} value={x.videoId}>{x.title}</option>)}
          </select>
        </div>
      )}
      {videoId && data.state === 'loading' && <p className="muted">Loading the video…</p>}
      {videoId && data.state === 'error' && <p className="err-text">{data.error.message}</p>}
      {videoId && data.state === 'ok' && <Editor key={videoId} data={data.data} />}
    </div>
  );
}
