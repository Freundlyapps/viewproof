/** Pages where the extension hands keyword facts to the ViewProof web app. Localhost only in development builds. */
export function appMatches(dev: boolean): string[] {
  return dev ? ['https://viewproof.app/*', 'http://localhost:8787/*', 'http://localhost:5173/*'] : ['https://viewproof.app/*'];
}
