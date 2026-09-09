import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Data Hub 5B.2 — static source-text containment proofs for the
// SourceSystem/SourceMapping/MappingVersion HTTP route layer. Mirrors
// the block-scoped substring-matching idiom already established by
// tests/containment/dataHubReadRoutes.test.ts and
// dataHubInitiateFinalizeRoutes.test.ts, rather than a DOM/route-runner
// harness this repo does not have.

const ROOT = path.resolve(__dirname, "../..");
function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const ROUTES = {
  sourceSystemsList: "app/api/data-hub/source-systems/route.ts",
  sourceSystemsById: "app/api/data-hub/source-systems/[id]/route.ts",
  sourceMappingsList: "app/api/data-hub/source-mappings/route.ts",
  sourceMappingsById: "app/api/data-hub/source-mappings/[id]/route.ts",
  mappingVersionsUnderMapping: "app/api/data-hub/source-mappings/[id]/versions/route.ts",
  activateVersion: "app/api/data-hub/source-mappings/[id]/activate-version/route.ts",
  mappingVersionById: "app/api/data-hub/mapping-versions/[id]/route.ts",
};

describe("5B.2 routes — authentication is required everywhere", () => {
  for (const [name, relPath] of Object.entries(ROUTES)) {
    it(`T68 — ${name} calls requireRole and returns 401 on Unauthorized`, () => {
      const src = read(relPath);
      expect(src).toContain("requireRole(");
      expect(src).toContain('status: 401');
    });
  }
});

describe("5B.2 routes — role gates: reads are manager+, writes are admin+", () => {
  it("T1/T3 — GET list/get routes require manager (not a lower bar)", () => {
    for (const relPath of [
      ROUTES.sourceSystemsList,
      ROUTES.sourceSystemsById,
      ROUTES.sourceMappingsList,
      ROUTES.sourceMappingsById,
      ROUTES.mappingVersionsUnderMapping,
      ROUTES.mappingVersionById,
    ]) {
      const src = read(relPath);
      const getBlockStart = src.indexOf("export async function GET");
      expect(getBlockStart).toBeGreaterThan(-1);
      const getBlock = src.slice(getBlockStart, src.indexOf("\n}", getBlockStart) + 2);
      expect(getBlock).toContain('requireRole("manager")');
    }
  });

  it("T4/T5/T19/T20/T41/T42/T55/T56 — every write route (POST/PATCH) requires admin, never merely manager", () => {
    for (const relPath of [
      ROUTES.sourceSystemsList, // POST
      ROUTES.sourceSystemsById, // PATCH
      ROUTES.sourceMappingsList, // POST
      ROUTES.sourceMappingsById, // PATCH
      ROUTES.mappingVersionsUnderMapping, // POST
      ROUTES.activateVersion, // POST
    ]) {
      const src = read(relPath);
      const writeMatch = src.match(/export async function (POST|PATCH)[\s\S]*?\n}/);
      expect(writeMatch).not.toBeNull();
      if (!writeMatch) continue;
      expect(writeMatch[0]).toContain('requireRole("admin")');
      // Must not ALSO be satisfiable by a bare "manager" requireRole call
      // inside the same write handler.
      expect(writeMatch[0]).not.toContain('requireRole("manager")');
    }
  });
});

describe("5B.2 routes — mass-assignment / injection hardening", () => {
  it("T6/T71 — organisationId is never read from the request body/query on any write route", () => {
    for (const relPath of [
      ROUTES.sourceSystemsList,
      ROUTES.sourceSystemsById,
      ROUTES.sourceMappingsList,
      ROUTES.sourceMappingsById,
      ROUTES.mappingVersionsUnderMapping,
      ROUTES.activateVersion,
    ]) {
      const src = read(relPath);
      expect(src).not.toMatch(/body\.organisationId/);
      expect(src).not.toMatch(/body\.organisation_id/);
      expect(src).not.toMatch(/searchParams\.get\(["']organisationId["']\)/);
      // organisationId used at all must come from session.
      expect(src).toContain("session.organisationId");
    }
  });

  it("T7/T72 — created_by is never read from the request body on any create route", () => {
    for (const relPath of [ROUTES.sourceSystemsList, ROUTES.sourceMappingsList, ROUTES.mappingVersionsUnderMapping]) {
      const src = read(relPath);
      expect(src).not.toMatch(/body\.created_by/);
      expect(src).not.toMatch(/body\.createdBy/);
    }
  });

  it("T73 — version_number is never read from the request body", () => {
    const src = read(ROUTES.mappingVersionsUnderMapping);
    expect(src).not.toMatch(/body\.version_number/);
    expect(src).not.toMatch(/body\.versionNumber/);
  });

  it("T74 — active_mapping_version_id can never reach source-mappings PATCH (generic-PATCH injection rejected)", () => {
    const src = read(ROUTES.sourceMappingsById);
    // The field may be named in a doc comment explaining the boundary,
    // but must never appear as an actual body-field read/assignment.
    expect(src).not.toMatch(/body\.active_mapping_version_id/);
    expect(src).not.toMatch(/body\.activeMappingVersionId/);
    // The known-field allowlist for this PATCH route is exactly name/active.
    expect(src).toContain('new Set(["name", "active"])');
  });

  it("POST bodies are never spread into a service call — every write hand-constructs its input object", () => {
    for (const relPath of [
      ROUTES.sourceSystemsList,
      ROUTES.sourceMappingsList,
      ROUTES.mappingVersionsUnderMapping,
      ROUTES.activateVersion,
    ]) {
      const src = read(relPath);
      expect(src).not.toMatch(/\.\.\.\s*body/);
    }
  });

  it("T70 — PATCH routes reject any field outside their own explicit allowlist", () => {
    const sysSrc = read(ROUTES.sourceSystemsById);
    expect(sysSrc).toContain('new Set(["name", "description", "active"])');
    expect(sysSrc).toContain("hasUnknownField");

    const mapSrc = read(ROUTES.sourceMappingsById);
    expect(mapSrc).toContain("hasUnknownField");
  });
});

describe("5B.2 routes — pagination / cursor hardening", () => {
  it("T75 — list routes bound the raw cursor length before it ever reaches the service layer", () => {
    for (const relPath of [ROUTES.sourceSystemsList, ROUTES.sourceMappingsList, ROUTES.mappingVersionsUnderMapping]) {
      const src = read(relPath);
      expect(src).toContain("MAX_CURSOR_LENGTH");
    }
  });
});

describe("5B.2 routes — error hygiene", () => {
  it("T77 — no route ever forwards a raw caught error's message to the client", () => {
    for (const relPath of Object.values(ROUTES)) {
      const src = read(relPath);
      // Every catch block must log server-side (console.error) and return
      // a fixed, hardcoded string — never `(err as Error).message` or
      // similar inside a client-facing NextResponse.json call.
      expect(src).toContain("console.error(");
      expect(src).not.toMatch(/NextResponse\.json\(\{\s*error:\s*\(?err/);
    }
  });
});

describe("5B.2 routes — no MappingVersion mutation/deletion surface exists", () => {
  it("T48/T49 — no PATCH/PUT/DELETE handler exists anywhere for mapping-versions", () => {
    const byId = read(ROUTES.mappingVersionById);
    expect(byId).not.toMatch(/export async function (PATCH|PUT|DELETE)/);
    const underMapping = read(ROUTES.mappingVersionsUnderMapping);
    expect(underMapping).not.toMatch(/export async function (PATCH|PUT|DELETE)/);
  });

  it("T15/T30 — no DELETE handler exists anywhere in the 5B.2 route surface", () => {
    for (const relPath of Object.values(ROUTES)) {
      const src = read(relPath);
      expect(src).not.toMatch(/export async function DELETE/);
    }
  });
});

describe("5B.2 — service layer does not import lib/org.ts (auth stays at the route boundary only)", () => {
  it("sourceSystems/sourceMappings/mappingVersions services never resolve their own session", () => {
    for (const relPath of [
      "lib/data-hub/sourceMapping/sourceSystems.ts",
      "lib/data-hub/sourceMapping/sourceMappings.ts",
      "lib/data-hub/sourceMapping/mappingVersions.ts",
    ]) {
      const src = read(relPath);
      expect(src).not.toContain("from \"@/lib/org\"");
      expect(src).not.toContain("from \"../../org\"");
      expect(src).not.toContain("requireRole(");
      expect(src).not.toContain("requireSession(");
    }
  });
});

describe("5B.2 — no new backend route beyond the certified 5B.2 surface, no schema/integrations coupling", () => {
  it("T78 — no Production configuration dependency anywhere in the new service/route files", () => {
    const files = [
      ...Object.values(ROUTES),
      "lib/data-hub/sourceMapping/types.ts",
      "lib/data-hub/sourceMapping/mappingDocument.ts",
      "lib/data-hub/sourceMapping/sourceSystems.ts",
      "lib/data-hub/sourceMapping/sourceMappings.ts",
      "lib/data-hub/sourceMapping/mappingVersions.ts",
      "lib/data-hub/sourceMapping/httpStatus.ts",
    ];
    for (const relPath of files) {
      const src = read(relPath);
      expect(src).not.toMatch(/thebrainbase\.com\.au/);
      expect(src).not.toMatch(/neon\.tech/);
      expect(src).not.toMatch(/DATABASE_URL/);
      expect(src).not.toMatch(/process\.env\./);
    }
  });

  it("no file in this domain imports lib/integrations/**", () => {
    const files = [
      ...Object.values(ROUTES),
      "lib/data-hub/sourceMapping/sourceSystems.ts",
      "lib/data-hub/sourceMapping/sourceMappings.ts",
      "lib/data-hub/sourceMapping/mappingVersions.ts",
    ];
    for (const relPath of files) {
      const src = read(relPath);
      // Catches "@/lib/integrations/...", any relative
      // "../integrations/..." import, AND a bare side-effect
      // `import "...integrations...";` with no `from` keyword.
      expect(src).not.toMatch(/import\s+(?:[^;'"]*\s+from\s+)?["'][^"']*integrations[^"']*["']/);
    }
  });

  it("no Phase 6 concept (SourceRecordIdentity/Observation/external_id/reconciliation) appears anywhere in 5B.2 source", () => {
    const files = [
      ...Object.values(ROUTES),
      "lib/data-hub/sourceMapping/types.ts",
      "lib/data-hub/sourceMapping/mappingDocument.ts",
      "lib/data-hub/sourceMapping/sourceSystems.ts",
      "lib/data-hub/sourceMapping/sourceMappings.ts",
      "lib/data-hub/sourceMapping/mappingVersions.ts",
    ];
    // These are checked as actual CODE constructs (field/type names, not
    // substrings), since this module's own doc comments legitimately
    // *name* several of these terms to explain that they are deliberately
    // EXCLUDED — e.g. "Phase 6 value mappings/reconciliation" — which
    // would otherwise be a false positive against a plain substring scan.
    const forbiddenAsIdentifier = ["SourceRecordIdentity", "Observation", "TechnologyOne", "Onkaparinga"];
    const forbiddenAsField = ["external_id", "canonical_hash", "reconciliation_status"];
    for (const relPath of files) {
      const src = read(relPath);
      for (const term of forbiddenAsIdentifier) {
        expect(src).not.toContain(term);
      }
      for (const term of forbiddenAsField) {
        // `?` allowed between the identifier and `:`/`=` to also catch a
        // TypeScript optional-property declaration (`external_id?: string`).
        expect(src).not.toMatch(new RegExp(`[:.]\\s*${term}|${term}\\??\\s*[:=]`));
      }
    }
  });
});

describe("5B.2 — import-flow files are entirely untouched by this slice (source-text non-reference proof)", () => {
  it("no 5B.2 service/route file is imported by any existing import-flow/UI file", () => {
    const importFlowFiles = [
      "lib/data-hub/importBatch/initiate.ts",
      "lib/data-hub/importBatch/finalize.ts",
      "lib/data-hub/importBatch/confirmWorksheet.ts",
      "lib/data-hub/client/orchestrator.ts",
    ];
    for (const relPath of importFlowFiles) {
      const full = path.join(ROOT, relPath);
      if (!fs.existsSync(full)) continue;
      const src = fs.readFileSync(full, "utf8");
      expect(src).not.toMatch(/sourceMapping\/(sourceSystems|sourceMappings|mappingVersions)/);
    }
  });
});

describe("5B.2 — no logging of full mapping document / request body", () => {
  it("M25 — no route or service ever passes `body` or a mapping document into a log call", () => {
    const files = [
      ...Object.values(ROUTES),
      "lib/data-hub/sourceMapping/mappingVersions.ts",
      "lib/data-hub/sourceMapping/sourceSystems.ts",
      "lib/data-hub/sourceMapping/sourceMappings.ts",
    ];
    for (const relPath of files) {
      const src = read(relPath);
      expect(src).not.toMatch(/console\.\w+\([^)]*\bbody\b/);
      expect(src).not.toMatch(/console\.\w+\([^)]*mappingDocument/);
      expect(src).not.toMatch(/console\.\w+\([^)]*mapping_document/);
    }
  });
});

describe("5B.2 — ImportBatch/Upload lineage columns are never written by this slice", () => {
  it("M26/M27 — no service in this domain ever calls importBatch.update*/upload.update* (source_system_id and mapping_version_id stay unwritten)", () => {
    const files = [
      "lib/data-hub/sourceMapping/sourceSystems.ts",
      "lib/data-hub/sourceMapping/sourceMappings.ts",
      "lib/data-hub/sourceMapping/mappingVersions.ts",
    ];
    for (const relPath of files) {
      const src = read(relPath);
      expect(src).not.toMatch(/prisma\.importBatch\./);
      expect(src).not.toMatch(/prisma\.upload\./);
      expect(src).not.toMatch(/\.importBatch\.update/);
      expect(src).not.toMatch(/\.upload\.update/);
    }
  });
});
