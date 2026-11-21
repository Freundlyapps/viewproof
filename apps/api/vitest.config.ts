import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('../../packages/db/migrations') // relative to apps/api, where vitest runs;
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            GOOGLE_CLIENT_ID: 'test-client-id',
            GOOGLE_CLIENT_SECRET: 'test-client-secret',
            // Test-only key (32 zero bytes). Real keys come from .dev.vars / Wrangler secrets.
            TOKEN_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
        },
      }),
    ],
    // One worker: parallel workerd start-ups crash (socket hang up) on the WSL /mnt/f mount.
    test: { setupFiles: ['./test/setup.ts'], maxWorkers: 1, fileParallelism: false },
  };
});
