import type { Child } from 'hono/jsx';

// Design tokens from spec §15; dark mode follows the visitor's system setting.
const css = `
:root{--bg:#FAFAF9;--surface:#fff;--text:#1C1917;--muted:#57534E;--border:#E7E5E4;--accent:#0F766E;--on-accent:#fff;--hi:#B45309;--neg:#B91C1C;
font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0F1115;--surface:#161920;--text:#E7E7EA;--muted:#9BA1AD;--border:#262A33;--accent:#2DD4BF;--on-accent:#042F2E;--hi:#F59E0B;--neg:#F87171;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}
header{display:flex;align-items:center;gap:10px;padding:14px clamp(16px,3vw,36px);border-bottom:1px solid var(--border);background:var(--surface)}
.logo{width:28px;height:28px;border-radius:8px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:800;font-size:.8rem}
header b{font-size:1.1rem} header .grow{flex:1}
main{max-width:720px;margin:clamp(20px,5vh,56px) auto;padding:0 16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:clamp(18px,3vw,28px)}
h1{font-size:1.45rem;margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:.88rem}
.btn{display:inline-block;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:9px;padding:9px 16px;font:inherit;font-weight:500;cursor:pointer;text-decoration:none}
.btn.pri{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.btn.danger{color:var(--neg)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.note{background:var(--bg);border-radius:10px;padding:10px 12px;font-size:.9rem;margin:14px 0}
.badge{font-size:.75rem;font-weight:600;border-radius:6px;padding:2px 8px}.ok{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.warn{background:color-mix(in srgb,var(--hi) 16%,transparent);color:var(--hi)}
.av{width:56px;height:56px;border-radius:50%;background:var(--border);object-fit:cover;flex:none}
.item{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--border)}.item:last-child{border-bottom:0}
form{display:inline}
footer{max-width:720px;margin:0 auto 32px;padding:0 16px;font-size:.85rem;color:var(--muted)}footer a{color:inherit}
`;

export function Layout(props: { title: string; signedIn?: boolean; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · ViewProof`}</title>
        <style>{css}</style>
      </head>
      <body>
        <header>
          <div class="logo">VP</div>
          <b>ViewProof</b>
          <span class="grow" />
          {props.signedIn ? <a class="btn" href="/account">Account</a> : null}
        </header>
        <main>{props.children}</main>
        <footer><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="https://github.com/Freundlyapps/viewproof">Source code</a></footer>
      </body>
    </html>
  );
}
