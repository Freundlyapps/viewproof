export function Soon(props: { title: string; text: string; sub?: string }) {
  return (
    <section className="screen">
      <div><h1>{props.title}</h1><p className="sub">{props.sub ?? 'Not built yet'}</p></div>
      <div className="card"><p style={{ margin: 0 }}>{props.text}</p></div>
    </section>
  );
}
