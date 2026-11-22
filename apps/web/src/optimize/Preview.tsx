/** Title at YouTube-like widths with 2-line clamping. A visual guide only, not a measurement. */
export function Preview(props: { title: string }) {
  if (!props.title.trim()) return null;
  return (
    <div className="stack-s">
      <p className="small muted">Approximate preview — YouTube's layout varies by device and font.</p>
      <div className="row previews">
        <div className="pv pv-search"><span className="small muted">Search results (desktop)</span><p className="pv-title">{props.title}</p></div>
        <div className="pv pv-home"><span className="small muted">Home (phone)</span><p className="pv-title">{props.title}</p></div>
      </div>
    </div>
  );
}
