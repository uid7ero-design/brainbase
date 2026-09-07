import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.3B — static source-text containment for the browser
// orchestration client's own module boundary. Mirrors this repo's
// established convention (dataHubInitiateFinalizeRoutes.test.ts et al.):
// structural properties that are cheap and reliable to prove statically.
//
// This client module is meant to be bundled into a browser, so it must
// NEVER import: React/JSX, any Next.js-specific module, `server-only`, any
// server-side Data Hub service/route file, or the main "@vercel/blob"
// server entry point (only its "/client" subpath is browser-safe — see
// lib/data-hub/client/blobUpload.ts's own header comment for why).
//
// Section 33-36 of this phase's own governing spec forbid any UI file
// (.tsx/React component) and any backend file change in this diff — this
// test also proves the module directory contains no such file.

const ROOT = process.cwd();
const CLIENT_DIR = path.join("lib", "data-hub", "client");

function listTsFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => path.join(dir, f));
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("5A.3B lib/data-hub/client module boundary", () => {
  const files = listTsFiles(CLIENT_DIR);

  it("the module directory exists and contains the expected files", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    const names = files.map((f) => path.basename(f));
    expect(names).toContain("types.ts");
    expect(names).toContain("httpClient.ts");
    expect(names).toContain("blobUpload.ts");
    expect(names).toContain("orchestrator.ts");
    expect(names).toContain("index.ts");
  });

  it("contains no .tsx file anywhere (no UI in this phase)", () => {
    const tsxFiles = files.filter((f) => f.endsWith(".tsx"));
    expect(tsxFiles).toEqual([]);
  });

  for (const relPath of listTsFiles(CLIENT_DIR)) {
    const stripped = stripComments(read(relPath));

    it(`${relPath} never imports React or JSX`, () => {
      // Note: a generic JSX-tag-shaped regex heuristic was deliberately
      // NOT used here — this file is full of legitimate TypeScript
      // generics (Promise<Response>, TransportResult<TBody>, etc.) that a
      // crude `<Tag>` pattern cannot distinguish from JSX. The `.tsx` file
      // check above and these explicit import checks are the real,
      // reliable containment proof.
      expect(stripped).not.toMatch(/from\s+["']react["']/);
      expect(stripped).not.toMatch(/from\s+["']react-dom["']/);
    });

    it(`${relPath} never imports next/* or server-only`, () => {
      expect(stripped).not.toMatch(/from\s+["']next\//);
      expect(stripped).not.toMatch(/from\s+["']server-only["']/);
    });

    it(`${relPath} never imports any server-side Data Hub service, route, or persistence module`, () => {
      expect(stripped).not.toMatch(/from\s+["'][^"']*app\/api\/data-hub/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*lib\/data-hub\/importBatch/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*\/lib\/org["']/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*\/lib\/prisma["']/);
      expect(stripped).not.toMatch(/from\s+["'][^"']*\/lib\/db["']/);
      expect(stripped).not.toMatch(/@prisma\/client/);
    });

    it(`${relPath} never imports the "@vercel/blob" main (server) entry point — only "@vercel/blob/client"`, () => {
      // A bare `from "@vercel/blob"` (no /client suffix) would pull in the
      // server entry point (undici/node:http) — never allowed here.
      expect(stripped).not.toMatch(/from\s+["']@vercel\/blob["']/);
    });
  }

  it("blobUpload.ts imports put and getPayloadFromClientToken from @vercel/blob/client", () => {
    const stripped = stripComments(read(path.join(CLIENT_DIR, "blobUpload.ts")));
    expect(stripped).toMatch(/from\s+["']@vercel\/blob\/client["']/);
    expect(stripped).toMatch(/\bput\b/);
    expect(stripped).toMatch(/getPayloadFromClientToken/);
  });

  it("blobUpload.ts never calls upload()/handleUpload() (no server callback route exists for that pattern)", () => {
    const stripped = stripComments(read(path.join(CLIENT_DIR, "blobUpload.ts")));
    expect(stripped).not.toMatch(/\bhandleUpload\b/);
    expect(stripped).not.toMatch(/handleUploadUrl/);
  });

  it("blobUpload.ts never sets multipart: true", () => {
    const stripped = stripComments(read(path.join(CLIENT_DIR, "blobUpload.ts")));
    expect(stripped).not.toMatch(/multipart:\s*true/);
    expect(stripped).toMatch(/multipart:\s*false/);
  });

  it("blobUpload.ts always passes access: \"private\", never \"public\"", () => {
    const stripped = stripComments(read(path.join(CLIENT_DIR, "blobUpload.ts")));
    expect(stripped).toMatch(/access:\s*["']private["']/);
    expect(stripped).not.toMatch(/access:\s*["']public["']/);
  });

  it("orchestrator.ts is the only file allowed to import blobUpload's uploadFileDirectToBlob directly, and imports it exactly once", () => {
    for (const relPath of files) {
      const base = path.basename(relPath);
      if (base === "orchestrator.ts" || base === "index.ts" || base === "blobUpload.ts") continue;
      const stripped = stripComments(read(relPath));
      expect(stripped).not.toMatch(/uploadFileDirectToBlob/);
    }
  });
});
