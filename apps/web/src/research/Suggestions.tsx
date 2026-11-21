import { Link } from 'react-router';
import { Badge } from '../ui/Badge';
import type { ExtensionAnswer } from './extension';
import { reportHref } from './KeywordReport';

export function Suggestions(props: { ext: ExtensionAnswer | null; country: string }) {
  const { ext } = props;
  const head = <h2>YouTube suggestions <Badge kind="real">REAL · YouTube</Badge></h2>;
  if (!ext || !ext.installed) return <div className="card">{head}<p className="empty">{ext ? "YouTube's autocomplete is read through the ViewProof extension." : 'Asking the extension…'}</p></div>;
  if (ext.suggestionsError) return <div className="card">{head}<p className="empty">{ext.suggestionsError}</p></div>;
  const s = ext.suggestions;
  const lists = [['Related', s?.related ?? []], ['Questions', s?.questions ?? []], ['Matching', s?.matching ?? []]] as const;
  return (
    <div className="card">
      {head}
      <p className="small muted" style={{ marginTop: -6 }}>YouTube's own autocomplete, in its order. Click one for its report.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        {lists.map(([title, items]) => (
          <div key={title}>
            <h3>{title}</h3>
            {items.length ? <ul>{items.map((k) => <li key={k}><Link to={reportHref(k, props.country)}>{k}</Link></li>)}</ul> : <p className="empty">None from YouTube.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
