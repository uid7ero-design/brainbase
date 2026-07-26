import { defineConfig } from 'vitest/config';
import path from 'path';

// Minimal Phase 0.5 containment test setup — scoped to server-side lib/route
// logic only, not the wider React/Next.js app. Mirrors tsconfig's "@/*" alias.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/containment/**/*.test.ts'],
    setupFiles: ['./tests/setupEnv.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // See tests/stubs/server-only.ts for why this alias exists.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
