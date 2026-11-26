import { LegalLinks } from './LegalLinks';

export function SignIn() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', alignContent: 'center', gap: 16, padding: 24 }}>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="brand"><div className="logo">VP</div><span>ViewProof</span></div>
        <h1>YouTube research you can check</h1>
        <p className="sub">Every number says where it comes from. Connecting gives ViewProof view-only access to your channel and its analytics.</p>
        <p><a className="btn pri" href="/auth/google/start">Sign in with Google</a></p>
      </div>
      <LegalLinks />
    </div>
  );
}
