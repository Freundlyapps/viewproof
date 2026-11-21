import { Layout } from './Layout';

export function Home(props: { signedIn: boolean }) {
  return (
    <Layout title="Home" signedIn={props.signedIn}>
      <div class="card">
        <h1>YouTube research you can check</h1>
        <p>ViewProof shows where every number comes from: real data from YouTube marked as real, estimates marked as estimates.</p>
        {props.signedIn ? (
          <a class="btn pri" href="/account">Go to your account</a>
        ) : (
          <>
            <p class="muted small">Connecting your channel gives ViewProof view only access to it and its analytics. It can't upload, edit or delete anything, and you can remove access any time.</p>
            <a class="btn pri" href="/auth/google/start">Sign in with Google</a>
          </>
        )}
      </div>
    </Layout>
  );
}
