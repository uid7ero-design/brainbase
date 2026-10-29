import type { NextConfig } from 'next';
import path from 'path';

// The standalone product lives inside the BrainBase repository
// (apps/eve) and compiles the shared ticketing core from
// packages/ticketing as source via the tsconfig path alias.
//
// Bundler: webpack (see package.json scripts). Turbopack needs
// `turbopack.root` raised to the repository root to read
// packages/ticketing, and at that root it also discovers the other
// application's middleware.ts and tries to build it as this app's —
// which is exactly the coupling this boundary exists to prevent. Webpack
// resolves the alias to an absolute path outside the app folder without
// widening the project root.
//
// outputFileTracingRoot is raised so the serverless trace includes the
// package files when Vercel builds with Root Directory = apps/eve.
const REPO_ROOT = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: REPO_ROOT,
  typedRoutes: false,
};

export default nextConfig;
