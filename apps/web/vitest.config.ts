import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// pool: 'threads' — forked workers time out on the /mnt/f (WSL Windows drive) mount.
export default defineConfig({
  plugins: [react()],
  test: { pool: 'threads', environment: 'happy-dom', include: ['test/**/*.test.tsx'], setupFiles: ['./test/setup.ts'], testTimeout: 30_000 },
});
