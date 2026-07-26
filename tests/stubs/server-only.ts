// Stub for Vitest: the real "server-only" package unconditionally throws
// unless Next.js's webpack config specially aliases it to a no-op. Vitest
// runs outside that bundler, so we alias the bare specifier to this empty
// module (see vitest.config.ts) purely so server-side modules that import
// "server-only" for its Next.js build-time guard remain importable in tests.
export {};
