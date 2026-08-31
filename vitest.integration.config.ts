import { defineConfig } from 'vitest/config';
import path from 'path';

// Data Hub 5A.2G.1 — real disposable-Postgres integration harness config.
//
// Deliberately SEPARATE from vitest.config.ts / the main `npm test` run:
// this suite requires a real Postgres connection (a disposable Docker
// container — see scripts/tests/verify-import-batch-service.sh) and must
// NEVER run as part of the standard blocking containment suite. It has no
// setupFiles (in particular, it does NOT load tests/setupEnv.ts's fake
// DATABASE_URL placeholder) — DATABASE_URL must already be set by the
// caller (the shell harness) to point at the disposable container before
// vitest even starts.
//
// Mirrors vitest.config.ts's alias setup (the "@/*" path alias and the
// server-only stub) since the code under test uses both.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/tests/importBatchService.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
