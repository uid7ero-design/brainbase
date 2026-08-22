import type { NextConfig } from "next";
import path from "path";
import fs from "fs";

const SRC  = path.resolve(__dirname, "Dashboards/command-centre.html");
const DEST = path.resolve(__dirname, "public/command-centre.html");

function copyCC() {
  try {
    fs.copyFileSync(SRC, DEST);
  } catch (e) {
    console.warn("[sync-dashboards] copy failed:", (e as Error).message);
  }
}

// Webpack plugin: copies on every build; in watch mode also sets up a
// chokidar watcher so edits to the source file hot-reload the iframe.
class SyncDashboardsPlugin {
  private watching = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply(compiler: any) {
    compiler.hooks.beforeRun.tapAsync("SyncDashboardsPlugin", (_c: unknown, done: () => void) => {
      copyCC();
      done();
    });

    compiler.hooks.watchRun.tapAsync("SyncDashboardsPlugin", (_c: unknown, done: () => void) => {
      // NOTE: do NOT call copyCC() here — writing to public/ triggers another
      // watchRun which writes again, creating an infinite recompile loop.
      // Initial copy + chokidar watcher handles all sync needs.
      if (!this.watching) {
        this.watching = true;
        copyCC(); // one-time copy when watch mode starts
        import("chokidar").then(({ default: chokidar }) => {
          chokidar.watch(SRC, { ignoreInitial: true }).on("change", () => {
            console.log("[sync-dashboards] command-centre.html updated → public/");
            copyCC();
          });
        });
      }
      done();
    });
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.trycloudflare.com', '*.local', '192.168.*.*', '10.*.*.*'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Organiser was promoted to its canonical route (/organiser) in Phase D.2
  // — it's a real BrainBase capability, not a Command Centre tool, and no
  // longer lives nested under /command. This keeps existing bookmarks/links
  // to the old /command/organiser path working. Query strings (e.g.
  // ?board=<id>, used by Founder OS's board deep-link) are forwarded
  // automatically by Next.js for a plain source/destination redirect like
  // this — no explicit `:path*`/query handling needed. Temporary (not
  // permanent) so this can still be adjusted later without browsers/CDNs
  // hard-caching the old→new mapping.
  async redirects() {
    return [
      {
        source: '/command/organiser',
        destination: '/organiser',
        permanent: false,
      },
    ];
  },
  webpack(config, { isServer }) {
    // Only attach once (server and client both compile; one is enough)
    if (!isServer) {
      config.plugins = config.plugins ?? [];
      config.plugins.push(new SyncDashboardsPlugin());
    }
    return config;
  },
};

export default nextConfig;
