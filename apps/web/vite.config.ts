import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = 'http://localhost:8787';
// Served by the Worker at /app (same origin as the API, so the session cookie applies).
// `vite` dev server: polling because /mnt/f (WSL) has no file events; API calls go to wrangler dev,
// with the Origin rewritten so the Worker's origin check accepts form posts in development only.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: { outDir: 'dist/app', emptyOutDir: true },
  server: {
    watch: { usePolling: true },
    proxy: Object.fromEntries(['/api', '/auth', '/account', '/connect', '/channels'].map((p) => [p, { target: API, headers: { origin: API } }])),
  },
});
