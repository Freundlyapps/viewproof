import { defineConfig } from 'vitest/config';

// Live model eval (plan 6c): plain Node, real network. Not part of `pnpm test`.
export default defineConfig({ test: { include: ['eval/live.eval.ts'], environment: 'node', testTimeout: 900_000, disableConsoleIntercept: true } });
