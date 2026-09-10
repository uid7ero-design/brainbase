import { defineConfig } from 'vitest/config';
import path from 'path';

// Standalone vitest config for the 5B.4C real-Postgres proof ONLY — never
// referenced by the default `npm test` / vitest.config.ts, and never part of
// the regular containment suite. Invoked explicitly:
//   DATABASE_URL=... DIRECT_URL=... npx vitest run \
//     --config tests/postgres-proof/vitest.proof.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/postgres-proof/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, '../setupEnv.ts')],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../..'),
      'server-only': path.resolve(__dirname, '../stubs/server-only.ts'),
    },
  },
});
