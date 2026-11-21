import { COUNTRIES, DEFAULT_COUNTRY, type KeywordEstimate, type YourTerms as YourTermsData, normalizeKeyword } from '@viewproof/core';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ChannelInfo } from '../api';
import { type Loaded, useApi } from '../useApi';
import { Estimate } from './Estimate';
import { type ExtensionAnswer, askExtension, onKeywordUpdated } from './extension';
import { recentKeywords, rememberKeyword } from './recent';
import { Suggestions } from './Suggestions';
import { TopResults } from './TopResults';
import { YourTerms } from './YourTerms';

export const reportHref = (q: string, country: string) => `/research/keywords?q=${encodeURIComponent(q)}&country=${country}`;

/** Search form, recent keywords, and the report for ?q= */
export function KeywordPage(props: { channel: ChannelInfo | null }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = normalizeKeyword(params.get('q') ?? '');
  const country = COUNTRIES.some((c) => c.code === params.get('country')) ? params.get('country')! : DEFAULT_COUNTRY;
  const [text, setText] = useState(params.get('q') ?? '');
  const [cc, setCc] = useState(country);
  useEffect(() => { setText(params.get('q') ?? ''); setCc(country); }, [params, country]);
  useEffect(() => { if (q) rememberKeyword(q); }, [q]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const k = normalizeKeyword(text);
    if (k) navigate(reportHref(k, cc));
  };
  const recent = recentKeywords().filter((k) => k !== q);
  return (
    <>
      <form className="card row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={submit}>
        <label style={{ flex: 1, minWidth: 220 }}>Keyword<br /><input value={text} maxLength={100} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} /></label>
        <label>Country<br />
          <select value={cc} onChange={(e) => setCc(e.target.value)}>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
        </label>
        <button type="submit" className="btn pri">Get report</button>
      </form>
      {recent.length > 0 ? (
        <p className="small muted">Recent: {recent.map((k, i) => <span key={k}>{i ? ' · ' : ''}<Link to={reportHref(k, country)}>{k}</Link></span>)}</p>
      ) : null}
      {q ? <KeywordReport key={`${q}|${country}`} q={q} country={country} channel={props.channel} /> : <p className="empty">Type a keyword to see what YouTube shows for it, YouTube's suggestions, and your own matching search terms.</p>}
    </>
  );
}

function KeywordReport(props: { q: string; country: string; channel: ChannelInfo | null }) {
  const { q, country, channel } = props;
  const [ext, setExt] = useState<ExtensionAnswer | null>(null);
  useEffect(() => {
    let live = true;
    const ask = () => void askExtension(q).then((a) => live && setExt(a));
    ask();
    const off = onKeywordUpdated((u) => { if (normalizeKeyword(u) === q) ask(); });
    return () => { live = false; off(); };
  }, [q]);
  const terms = useApi<YourTermsData>(channel ? `/api/channels/${channel.id}/keyword-terms?q=${encodeURIComponent(q)}` : null);
  const estimate = useApi<KeywordEstimate>(`/api/keywords/estimate?q=${encodeURIComponent(q)}&country=${country}`);
  const nothing = noDataAnywhere(ext, channel ? terms : null, estimate);
  return (
    <>
      {nothing ? <p className="banner">No data for this keyword from any source yet.</p> : null}
      <TopResults q={q} ext={ext} />
      <Suggestions ext={ext} country={country} />
      <YourTerms channel={channel} r={terms} />
      <Estimate r={estimate} />
    </>
  );
}

/** True only once every source has answered and none had anything. */
function noDataAnywhere(ext: ExtensionAnswer | null, terms: Loaded<YourTermsData> | null, est: Loaded<KeywordEstimate>): boolean {
  if (!ext || est.state === 'loading' || terms?.state === 'loading') return false;
  const hasExt = ext.installed && (!!ext.snapshot?.page.results.length || !!ext.suggestions && Object.values(ext.suggestions).some((l) => l.length > 0));
  const hasTerms = terms?.state === 'ok' && terms.data.terms.length > 0;
  const hasEst = est.state === 'ok' && est.data.status === 'ok' && est.data.volume.kind === 'value';
  return !hasExt && !hasTerms && !hasEst;
}
