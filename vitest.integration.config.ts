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
//
// 5A.2H.1 addition: scripts/tests/inspectWorksheets.integration.test.ts
// (the worksheet inspection/persistence service's own real-Postgres
// harness — see scripts/tests/verify-inspect-worksheets.sh) is added to
// `include` alongside the existing 5A.2G.1 spec. Each harness script
// still invokes vitest with an explicit file argument (see both .sh
// scripts) so either suite can be run independently without collecting
// the other.
//
// 5A.2H.2 addition: scripts/tests/worksheetReadService.integration.test.ts
// (the dark tenant-safe worksheet/ImportBatch read services' own
// real-Postgres harness — see scripts/tests/verify-worksheet-read-service.sh)
// is added alongside the existing two specs, for the same reason and with
// the same explicit-file-argument isolation.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'scripts/tests/importBatchService.integration.test.ts',
      'scripts/tests/inspectWorksheets.integration.test.ts',
      'scripts/tests/worksheetReadService.integration.test.ts',
    ],
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
