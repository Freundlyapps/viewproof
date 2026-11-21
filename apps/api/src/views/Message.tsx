import { Layout } from './Layout';

/** A one-message page with a single next step. */
export function Message(props: { title: string; text: string; detail?: string; action?: { href: string; label: string } }) {
  return (
    <Layout title={props.title}>
      <div class="card">
        <h1>{props.title}</h1>
        <p>{props.text}</p>
        {props.detail ? <p class="muted small">{props.detail}</p> : null}
        {props.action ? <a class="btn pri" href={props.action.href}>{props.action.label}</a> : null}
      </div>
    </Layout>
  );
}
