import { defineConfig } from 'vitest/config';
import path from 'path';

// Two projects:
//  - containment: the Phase 0.5 static source-text suite — server-side lib/
//    route logic in plain Node (unchanged).
//  - components: rendered React component tests (jsdom + React Testing
//    Library + jest-axe) for the public-site design system. Helpers live
//    in tests/a11y/.
//  - packages: unit + boundary tests for the shared packages under
//    packages/* (currently @ticketing/core). Plain Node, no app setup.
// All mirror tsconfig's "@/*" alias via the shared root `resolve`.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/*/tests/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'containment',
          environment: 'node',
          include: ['tests/containment/**/*.test.ts'],
          setupFiles: ['./tests/setupEnv.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['./tests/setupEnv.ts', './tests/a11y/setup.ts'],
          css: { include: [/\.module\.css$/], modules: { classNameStrategy: 'non-scoped' } },
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Shared ticketing core (packages/ticketing) — mirrors tsconfig's
      // '@ticketing/core' paths. Subpath first so it matches before the bare name.
      '@ticketing/core/': path.resolve(__dirname, 'packages/ticketing/src') + '/',
      '@ticketing/core': path.resolve(__dirname, 'packages/ticketing/src/index.ts'),
      // Shared scheduling core (packages/scheduling) — mirrors tsconfig's
      // '@scheduling/core' paths. Subpath first so it matches before the bare name.
      '@scheduling/core/': path.resolve(__dirname, 'packages/scheduling/src') + '/',
      '@scheduling/core': path.resolve(__dirname, 'packages/scheduling/src/index.ts'),
      // See tests/stubs/server-only.ts for why this alias exists.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
});
