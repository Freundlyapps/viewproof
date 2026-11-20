import { defineConfig } from 'vitest/config';

// pool: 'threads' — forked workers time out on the /mnt/f (WSL Windows drive) mount.
export default defineConfig({ test: { pool: 'threads' } });
