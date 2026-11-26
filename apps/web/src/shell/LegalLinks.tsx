/** The server's privacy, terms and legal notice pages. Plain links: they live outside the React app (not under /app). */
export function LegalLinks() {
  return (
    <footer className="legal small muted">
      <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/imprint">Legal notice</a> · <a href="https://github.com/Freundlyapps/viewproof">Source code</a>
    </footer>
  );
}
