import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@ticketing/core/': path.resolve(__dirname, '../../packages/ticketing/src') + '/',
      '@ticketing/core': path.resolve(__dirname, '../../packages/ticketing/src/index.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});
