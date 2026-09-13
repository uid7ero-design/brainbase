import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 6.1C — static source-text containment for the Source
// configuration admin UI (app/data-hub/sources/**) and its new client-layer
// additions to lib/data-hub/client/{httpClient,orchestrator,types}.ts. No
// component-rendering harness exists in this repo (see CLAUDE.md) — these
// assertions prove structural/security invariants directly against the
// source text, matching the established idiom used throughout
// tests/containment/**.

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}

const PAGE = read("app/data-hub/sources/page.tsx");
const CLIENT = read("app/data-hub/sources/SourcesAdminClient.tsx");
const HTTP_CLIENT = read("lib/data-hub/client/httpClient.ts");
const ORCHESTRATOR = read("lib/data-hub/client/orchestrator.ts");

describe("app/data-hub/sources/page.tsx", () => {
  it("gates on requireRole('manager') and redirects on failure, matching every other Data Hub page", () => {
    expect(PAGE).toContain('requireRole("manager")');
    expect(PAGE).toContain('redirect("/login")');
  });

  it("computes isAdmin server-side via roleGte and passes it as a plain prop, never importing lib/org.ts from the client", () => {
    expect(PAGE).toContain("roleGte(session.role");
    expect(PAGE).toContain("isAdmin={isAdmin}");
    // The client component itself must not import the server-only auth
    // modules — that would ship a `server-only`/DB-adjacent import into
    // the browser bundle (the exact class of defect this repo's own
    // project_client_server_bundle_leak precedent warns about).
    expect(CLIENT).not.toContain('from "@/lib/org"');
    expect(CLIENT).not.toContain("from '@/lib/org'");
    expect(CLIENT).not.toContain('from "@/lib/session"');
    expect(CLIENT).not.toContain("from '@/lib/session'");
  });
});

describe("SourcesAdminClient.tsx — client/server boundary", () => {
  it("never imports httpClient.ts directly — only the orchestrator re-exports, preserving the existing package boundary", () => {
    expect(CLIENT).not.toMatch(/from ["']@\/lib\/data-hub\/client\/httpClient["']/);
    expect(CLIENT).toContain('from "@/lib/data-hub/client/orchestrator"');
  });

  it("reuses the existing canonical-target vocabulary rather than hand-duplicating it", () => {
    expect(CLIENT).toContain("CANONICAL_TARGET_FIELDS");
    expect(CLIENT).toContain('from "@/lib/data-hub/sourceMapping/mappingDocument"');
    expect(CLIENT).toContain("ILLEGAL_DUMPING_REQUIRED_HEADERS");
    // No hand-rolled duplicate of the 13-field canonical list anywhere in
    // this file.
    expect(CLIENT).not.toMatch(/\[\s*"report_date"\s*,\s*"location"/);
  });

  it("never sends organisation_id/organisationId in any client-constructed request", () => {
    expect(CLIENT).not.toMatch(/organisation_id\s*:/);
    expect(CLIENT).not.toMatch(/organisationId\s*:/);
  });
});

describe("SourcesAdminClient.tsx — required UX states", () => {
  it("has a loading state for every section", () => {
    expect(CLIENT.match(/status === "loading"/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("has a zero-source-systems empty state", () => {
    expect(CLIENT).toMatch(/No source systems configured/);
  });

  it("has an error banner rendered for any error state (covers a 403 the same as any other API failure)", () => {
    expect(CLIENT).toContain('status === "error"');
    expect(CLIENT).toContain("ErrorBanner");
  });

  it("has an explicit permission-denied notice for non-admin viewers, separate from any individual disabled control", () => {
    expect(CLIENT).toMatch(/!isAdmin[\s\S]{0,400}admin<\/strong>/);
  });

  it("has a two-step (not single-click) deactivate confirmation, matching this repo's own no-modal precedent", () => {
    expect(CLIENT).toContain("confirming");
    expect(CLIENT).toMatch(/Deactivate this\?/);
  });

  it("shows an active-version indicator distinct from a merely-existing version", () => {
    expect(CLIENT).toContain("active && <Badge active");
  });

  it("does not claim a mapping has been validated against real data, and points to the existing Preview flow instead of building a second one", () => {
    expect(CLIENT).toMatch(/has been validated against real data/i);
    expect(CLIENT).toContain("/data-hub/import");
  });
});

describe("SourcesAdminClient.tsx — permission gating on every mutating control", () => {
  it("disables every mutating button for a non-admin viewer (defense-in-depth; the API route remains the real gate)", () => {
    // Every create/edit/rename/activate/deactivate control must be
    // disabled when !isAdmin — spot-check each mutating action string.
    for (const action of ["New source system", "New mapping", "Create version"]) {
      const idx = CLIENT.indexOf(action);
      expect(idx, `expected to find button text "${action}"`).toBeGreaterThan(-1);
    }
    expect(CLIENT.match(/disabled={!isAdmin/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("never silently activates a newly created MappingVersion — creation and activation are distinct actions", () => {
    const createIdx = CLIENT.indexOf("async function handleCreate()");
    const nextFnIdx = CLIENT.indexOf("async function handleActivate", createIdx);
    const createBody = CLIENT.slice(createIdx, nextFnIdx);
    expect(createBody).not.toContain("activateMappingVersion(");
    expect(CLIENT).toMatch(/not active yet/i);
  });
});

describe("lib/data-hub/client/httpClient.ts — Source configuration admin request shapes", () => {
  it("createSourceSystem sends only name/description, never organisation_id/createdBy/active", () => {
    const start = HTTP_CLIENT.indexOf("export async function createSourceSystem(");
    const end = HTTP_CLIENT.indexOf("\n}", start);
    const fn = HTTP_CLIENT.slice(start, end);
    expect(fn).toContain('method: "POST"');
    expect(fn).toContain("JSON.stringify(input)");
    expect(fn).not.toMatch(/organisation/i);
  });

  it("updateSourceSystem PATCHes /api/data-hub/source-systems/[id]", () => {
    const start = HTTP_CLIENT.indexOf("export async function updateSourceSystem(");
    const end = HTTP_CLIENT.indexOf("\n}", start);
    const fn = HTTP_CLIENT.slice(start, end);
    expect(fn).toContain('method: "PATCH"');
    expect(fn).toContain("/api/data-hub/source-systems/${encodeURIComponent(sourceSystemId)}");
  });

  it("createSourceMapping sends exactly {sourceSystemId, name}", () => {
    const start = HTTP_CLIENT.indexOf("export async function createSourceMapping(");
    const end = HTTP_CLIENT.indexOf("\n}", start);
    const fn = HTTP_CLIENT.slice(start, end);
    expect(fn).toContain('resolveUrl(config, "/api/data-hub/source-mappings")');
    expect(fn).toContain("JSON.stringify(input)");
  });

  it("createMappingVersion POSTs {mappingDocument} to the versions route, never a bare fields object", () => {
    const start = HTTP_CLIENT.indexOf("export async function createMappingVersion(");
    const end = HTTP_CLIENT.indexOf("\n}", start);
    const fn = HTTP_CLIENT.slice(start, end);
    expect(fn).toContain("/versions`)");
    expect(fn).toContain("JSON.stringify({ mappingDocument })");
  });

  it("activateMappingVersion POSTs {mappingVersionId} to the dedicated activate-version route", () => {
    const start = HTTP_CLIENT.indexOf("export async function activateMappingVersion(");
    const end = HTTP_CLIENT.indexOf("\n}", start);
    const fn = HTTP_CLIENT.slice(start, end);
    expect(fn).toContain("/activate-version`)");
    expect(fn).toContain("JSON.stringify({ mappingVersionId })");
  });

  it("none of the six new admin functions accept or forward an organisationId parameter", () => {
    for (const name of [
      "listSourceSystemsAdmin",
      "createSourceSystem",
      "updateSourceSystem",
      "listSourceMappingsAdmin",
      "createSourceMapping",
      "updateSourceMapping",
      "createMappingVersion",
      "activateMappingVersion",
    ]) {
      const start = HTTP_CLIENT.indexOf(`export async function ${name}(`);
      expect(start, `expected to find ${name}`).toBeGreaterThan(-1);
      const end = HTTP_CLIENT.indexOf("\n}", start);
      const fn = HTTP_CLIENT.slice(start, end);
      expect(fn, `${name} must not reference organisationId`).not.toMatch(/organisationId/);
    }
  });
});

describe("lib/data-hub/client/orchestrator.ts — admin passthroughs preserve the existing boundary", () => {
  it("re-exports every new admin function as a thin passthrough", () => {
    for (const name of [
      "listSourceSystemsAdmin",
      "createSourceSystem",
      "updateSourceSystem",
      "listSourceMappingsAdmin",
      "createSourceMapping",
      "updateSourceMapping",
      "listMappingVersions",
      "createMappingVersion",
      "activateMappingVersion",
    ]) {
      expect(ORCHESTRATOR, `expected orchestrator.ts to export ${name}`).toMatch(new RegExp(`export function ${name}\\(`));
    }
  });
});
