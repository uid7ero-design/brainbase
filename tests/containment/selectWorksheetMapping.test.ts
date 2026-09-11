import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5B.4B — static containment + mocked-behavioral proof for the
// dedicated worksheet mapping-selection service (selectWorksheetMapping.ts)
// and its route (app/api/data-hub/worksheets/[id]/mapping-selection/route.ts).
//
// Real-Postgres atomicity/tenant/cross-source/reselection/concurrency
// proofs live in the separate
// scripts/tests/selectWorksheetMapping.integration.test.ts harness (see
// scripts/tests/verify-select-worksheet-mapping.sh) — this file does not
// attempt to prove genuine DB-level atomicity, since a mocked
// prisma.$transaction cannot.

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE_PATH = "lib/data-hub/importBatch/selectWorksheetMapping.ts";
const ROUTE_PATH = "app/api/data-hub/worksheets/[id]/mapping-selection/route.ts";
const PREVIEW_PATH = "app/api/data-hub/worksheets/[id]/preview/route.ts";
const CONFIRM_SERVICE_PATH = "lib/data-hub/importBatch/confirmWorksheet.ts";
const PREVIEW_SERVICE_PATH = "lib/data-hub/importBatch/previewWorksheet.ts";
const MAPPING_EXECUTION_PATH = "lib/data-hub/sourceMapping/mappingExecution.ts";
const ORCHESTRATOR_PATH = "lib/data-hub/client/orchestrator.ts";
const REVIEW_PANEL_PATH = "app/data-hub/import/_components/ReviewPanel.tsx";

// ─── Trusted-input-only shape ───────────────────────────────────────────

describe("selectWorksheetMapping — trusted-context-only input shape", () => {
  const code = read(SERVICE_PATH);

  it("SelectWorksheetMappingTrustedContext carries exactly organisationId, worksheetUploadId, sourceMappingId", () => {
    const block = code.match(/export interface SelectWorksheetMappingTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/organisationId:\s*string/);
    expect(block).toMatch(/worksheetUploadId:\s*string/);
    expect(block).toMatch(/sourceMappingId:\s*unknown/);
    const fieldLines = block
      .split("\n")
      .filter((l) => /:\s*\S/.test(l) && !l.trim().startsWith("/") && !l.trim().startsWith("*"));
    expect(fieldLines).toHaveLength(3);
  });

  it("T4/T5/T6 — the INPUT (trusted context) never accepts mappingVersionId, sourceSystemId, or a second organisationId-shaped field beyond the one trusted parameter", () => {
    // mappingVersionId/versionNumber legitimately appear in the OUTPUT type
    // (the caller is told what was frozen) — this check is scoped to the
    // input interface only.
    const block = code.match(/export interface SelectWorksheetMappingTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).not.toMatch(/mappingVersionId/);
    expect(block).not.toMatch(/sourceSystemId/);
  });

  it("never imports lib/org.ts or resolves its own session/auth", () => {
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(/requireSession|requireRole/);
    expect(stripped).not.toMatch(/from\s+["'].*lib\/org["']/);
    expect(stripped).not.toMatch(/next\/server/);
  });

  it("carries an AUTH BOUNDARY / TRUSTED INPUT header comment", () => {
    expect(code).toMatch(/AUTH BOUNDARY/);
    expect(code).toMatch(/TRUSTED INPUT/);
  });
});

// ─── One transaction, atomic conditional write (Section 14/15) ────────

describe("selectWorksheetMapping — one transaction, atomic conditional write", () => {
  const code = read(SERVICE_PATH);

  it("prisma.$transaction is called exactly once", () => {
    const matches = code.match(/prisma\.\$transaction\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("every authoritative read (worksheet/batch/sourceSystem/sourceMapping/mappingVersion) happens via tx., not prisma., inside the transaction", () => {
    const txBody = code.slice(code.indexOf("prisma.$transaction(async (tx) => {"));
    expect(txBody).toMatch(/tx\.upload\.findFirst/);
    expect(txBody).toMatch(/tx\.importBatch\.findUnique/);
    expect(txBody).toMatch(/tx\.sourceSystem\.findUnique/);
    expect(txBody).toMatch(/tx\.sourceMapping\.findUnique/);
    expect(txBody).toMatch(/tx\.mappingVersion\.findUnique/);
  });

  it("the write is a single conditional updateMany whose where clause repeats id, organisation_id, lineage_kind, and canonical_status = AWAITING_CONFIRMATION", () => {
    const updateCall = code.match(/tx\.upload\.updateMany\(\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(updateCall).toMatch(/id:\s*worksheetUploadId/);
    expect(updateCall).toMatch(/organisation_id:\s*organisationId/);
    expect(updateCall).toMatch(/lineage_kind:\s*["']DATA_HUB["']/);
    expect(updateCall).toMatch(/canonical_status:\s*["']AWAITING_CONFIRMATION["']/);
    expect(updateCall).toMatch(/mapping_version_id:\s*version\.id/);
  });

  it("no plain prisma.upload.update / prisma.upload.updateMany (unconditional) exists anywhere", () => {
    expect(code).not.toMatch(/prisma\.upload\.update\(/);
    // The only updateMany is the tx-scoped one already asserted above.
    const updateManyMatches = code.match(/\.upload\.updateMany\(/g) ?? [];
    expect(updateManyMatches).toHaveLength(1);
  });
});

// ─── NULL-source / cross-source / no-fallback invariants (hard requirements) ──

describe("selectWorksheetMapping — every tenant-scoped lookup uses the compound id_organisation_id key with the trusted organisationId", () => {
  const code = read(SERVICE_PATH);
  it("all 4 authoritative lookups (batch, sourceSystem, sourceMapping, mappingVersion) are tenant-scoped via id_organisation_id: { ..., organisation_id: organisationId }", () => {
    const matches = code.match(/id_organisation_id:\s*\{\s*id:\s*\S+,\s*organisation_id:\s*organisationId\s*\}/g) ?? [];
    expect(matches).toHaveLength(4);
  });
});

describe("selectWorksheetMapping — critical invariants present in source", () => {
  const code = read(SERVICE_PATH);

  it("NULL batch.source_system_id is checked and rejected before any mapping lookup", () => {
    const nullCheckIdx = code.indexOf("batch.source_system_id === null");
    const mappingLookupIdx = code.indexOf("tx.sourceMapping.findUnique");
    expect(nullCheckIdx).toBeGreaterThan(0);
    expect(mappingLookupIdx).toBeGreaterThan(0);
    expect(nullCheckIdx).toBeLessThan(mappingLookupIdx);
  });

  it("the cross-source equality check compares mapping.source_system_id against the batch's own authoritative value, never a caller-supplied one", () => {
    expect(code).toMatch(/mapping\.source_system_id\s*!==\s*authoritativeSourceSystemId/);
    // No field named sourceSystemId ever appears on the trusted context.
    const block = code.match(/export interface SelectWorksheetMappingTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).not.toMatch(/sourceSystemId/);
  });

  it("no MAX(version_number) / latest-version fallback exists in executable code (comments may reference what is NOT done)", () => {
    const executable = stripComments(code);
    expect(executable).not.toMatch(/MAX\(/i);
    expect(executable).not.toMatch(/version_number.*desc/i);
    expect(executable).not.toMatch(/orderBy/);
  });

  it("mapping.active_mapping_version_id (the resolved value from Step 6's own SourceMapping read) is referenced exactly twice in executable code — the null-check and the version lookup — never a second independent DB read of the live SourceMapping row", () => {
    const executable = stripComments(code);
    const matches = executable.match(/mapping\.active_mapping_version_id/g) ?? [];
    expect(matches).toHaveLength(2);
    // And there is only ONE sourceMapping.findUnique call in the whole file.
    const findUniqueMatches = executable.match(/sourceMapping\.findUnique/g) ?? [];
    expect(findUniqueMatches).toHaveLength(1);
  });
});

// ─── No downstream / execution / UI integration (Sections 24-26) ──────

describe("selectWorksheetMapping — zero downstream integration", () => {
  it("service file never imports mappingExecution.ts", () => {
    const code = stripComments(read(SERVICE_PATH));
    expect(code).not.toMatch(/mappingExecution/);
  });

  it("service file never calls compileMapping / applyCompiledMappingToRow", () => {
    const code = stripComments(read(SERVICE_PATH));
    expect(code).not.toMatch(/compileMapping|applyCompiledMappingToRow/);
  });

  for (const file of [PREVIEW_SERVICE_PATH, CONFIRM_SERVICE_PATH, PREVIEW_PATH, ORCHESTRATOR_PATH, REVIEW_PANEL_PATH]) {
    it(`${file} never references selectWorksheetMapping or mapping-selection`, () => {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/selectWorksheetMapping/);
      expect(code).not.toMatch(/mapping-selection/);
    });
  }

  it("mappingExecution.ts is untouched by this slice (no reference to selectWorksheetMapping)", () => {
    const code = stripComments(read(MAPPING_EXECUTION_PATH));
    expect(code).not.toMatch(/selectWorksheetMapping/);
  });
});

// ─── No schema/migration change proof (structural, re-derived here) ───

describe("selectWorksheetMapping — no Phase 6 / recognition / scheduling leakage", () => {
  it("service and route contain no Phase 6 (external_id/reconciliation/Observation/SourceRecordIdentity), recognition, or lib/integrations reference", () => {
    for (const file of [SERVICE_PATH, ROUTE_PATH]) {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/external_id|reconciliation|Observation|SourceRecordIdentity|Onkaparinga|TechnologyOne/i);
      expect(code).not.toMatch(/lib\/integrations/);
      expect(code).not.toMatch(/headerFingerprint|automaticRecognition|autoRecogni[sz]e/i);
    }
  });
});

describe("selectWorksheetMapping — no schema/migration change", () => {
  it("prisma/schema.prisma contains no update route/service reference (structural sanity — schema is data-only)", () => {
    // This is a narrow sanity check, not the authoritative proof (that is
    // the git diff itself, checked at merge/PR time) — just confirms the
    // service relies on the pre-existing Upload.mapping_version_id column
    // name exactly as already shipped in 5B.1.
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/mapping_version_id\s+String\?/);
  });
});

// ─── Mocked-behavioral tests: selectWorksheetMapping's own decision logic ──

const findFirstMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const sourceSystemFindUniqueMock = vi.fn();
const sourceMappingFindUniqueMock = vi.fn();
const mappingVersionFindUniqueMock = vi.fn();
const updateManyMock = vi.fn();

function txStub() {
  return {
    upload: { findFirst: (...a: unknown[]) => findFirstMock(...a), updateMany: (...a: unknown[]) => updateManyMock(...a) },
    importBatch: { findUnique: (...a: unknown[]) => importBatchFindUniqueMock(...a) },
    sourceSystem: { findUnique: (...a: unknown[]) => sourceSystemFindUniqueMock(...a) },
    sourceMapping: { findUnique: (...a: unknown[]) => sourceMappingFindUniqueMock(...a) },
    mappingVersion: { findUnique: (...a: unknown[]) => mappingVersionFindUniqueMock(...a) },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) => cb(txStub()),
  },
}));

async function freshService() {
  vi.resetModules();
  return import("@/lib/data-hub/importBatch/selectWorksheetMapping");
}

function worksheetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "worksheet-1", import_batch_id: "batch-1", canonical_status: "AWAITING_CONFIRMATION", ...overrides };
}
function batchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { source_system_id: "source-1", ...overrides };
}
function sourceSystemRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { active: true, ...overrides };
}
function sourceMappingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "mapping-1", active: true, source_system_id: "source-1", active_mapping_version_id: "version-1", ...overrides };
}
function mappingVersionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "version-1", source_mapping_id: "mapping-1", version_number: 3, ...overrides };
}

function mockHappyPath(overrides: {
  worksheet?: Partial<Record<string, unknown>>;
  batch?: Partial<Record<string, unknown>>;
  system?: Partial<Record<string, unknown>>;
  mapping?: Partial<Record<string, unknown>>;
  version?: Partial<Record<string, unknown>>;
  claimCount?: number;
} = {}) {
  findFirstMock.mockResolvedValue(worksheetRow(overrides.worksheet));
  importBatchFindUniqueMock.mockResolvedValue(batchRow(overrides.batch));
  sourceSystemFindUniqueMock.mockResolvedValue(sourceSystemRow(overrides.system));
  sourceMappingFindUniqueMock.mockResolvedValue(sourceMappingRow(overrides.mapping));
  mappingVersionFindUniqueMock.mockResolvedValue(mappingVersionRow(overrides.version));
  updateManyMock.mockResolvedValue({ count: overrides.claimCount ?? 1 });
}

beforeEach(() => {
  findFirstMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  sourceSystemFindUniqueMock.mockReset();
  sourceMappingFindUniqueMock.mockReset();
  mappingVersionFindUniqueMock.mockReset();
  updateManyMock.mockReset();
});

describe("selectWorksheetMapping — T1/T2/T3 basic selection success", () => {
  it("T1/T2/T3 — active same-tenant mapping accepted, exact version persisted, response returns frozen identity", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath();
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toEqual({
      ok: true,
      worksheetUploadId: "worksheet-1",
      sourceMappingId: "mapping-1",
      mappingVersionId: "version-1",
      versionNumber: 3,
    });
    const updateArg = updateManyMock.mock.calls[0][0];
    expect(updateArg.data).toEqual({ mapping_version_id: "version-1" });
  });
});

describe("selectWorksheetMapping — request validation", () => {
  it("non-string sourceMappingId -> INVALID_REQUEST, no DB call at all", async () => {
    const { selectWorksheetMapping } = await freshService();
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: 123 });
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("empty-string sourceMappingId -> INVALID_REQUEST", async () => {
    const { selectWorksheetMapping } = await freshService();
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "" });
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
});

describe("selectWorksheetMapping — T7-T11 worksheet/batch lineage", () => {
  it("T7/T8/T9 — nonexistent/foreign worksheet -> WORKSHEET_NOT_FOUND", async () => {
    const { selectWorksheetMapping } = await freshService();
    findFirstMock.mockResolvedValue(null);
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "nope", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("T11 — the tenant+lineage predicate is passed in the same findFirst call", async () => {
    const { selectWorksheetMapping } = await freshService();
    findFirstMock.mockResolvedValue(null);
    await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "w-1", sourceMappingId: "mapping-1" });
    const callArg = findFirstMock.mock.calls[0][0];
    expect(callArg.where).toMatchObject({ id: "w-1", organisation_id: "org-1", lineage_kind: "DATA_HUB" });
  });

  it("parent batch missing -> WORKSHEET_NOT_FOUND", async () => {
    const { selectWorksheetMapping } = await freshService();
    findFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(null);
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });
});

describe("selectWorksheetMapping — T12 NULL-source policy", () => {
  it("NULL ImportBatch.source_system_id blocks selection entirely, no SourceMapping lookup at all", async () => {
    const { selectWorksheetMapping } = await freshService();
    findFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ source_system_id: null }));
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_LINEAGE_REQUIRED" });
    expect(sourceMappingFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("selectWorksheetMapping — T13 SourceSystem active gate", () => {
  it("inactive parent SourceSystem -> SOURCE_MAPPING_UNAVAILABLE, no SourceMapping lookup", async () => {
    const { selectWorksheetMapping } = await freshService();
    findFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    sourceSystemFindUniqueMock.mockResolvedValue(sourceSystemRow({ active: false }));
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
    expect(sourceMappingFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("selectWorksheetMapping — T15/T16 SourceMapping tenant/cross-source", () => {
  it("T16 — foreign/nonexistent SourceMapping -> SOURCE_MAPPING_UNAVAILABLE", async () => {
    const { selectWorksheetMapping } = await freshService();
    findFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    sourceSystemFindUniqueMock.mockResolvedValue(sourceSystemRow());
    sourceMappingFindUniqueMock.mockResolvedValue(null);
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-x" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
  });

  it("T15 — same-tenant mapping under the WRONG SourceSystem -> SOURCE_MAPPING_UNAVAILABLE", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath({ mapping: { source_system_id: "source-DIFFERENT" } });
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
    expect(mappingVersionFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("selectWorksheetMapping — T17/T18 mapping state", () => {
  it("T17 — inactive SourceMapping -> SOURCE_MAPPING_UNAVAILABLE", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath({ mapping: { active: false } });
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
  });

  it("T18 — SourceMapping with NULL active_mapping_version_id -> SOURCE_MAPPING_UNAVAILABLE, no version lookup", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath({ mapping: { active_mapping_version_id: null } });
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
    expect(mappingVersionFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("selectWorksheetMapping — T20/T21/T22 active-version resolution", () => {
  it("T20 — resolved MappingVersion belongs to a DIFFERENT SourceMapping (corrupt pointer) -> SOURCE_MAPPING_UNAVAILABLE, never falls back", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath({ version: { source_mapping_id: "some-other-mapping" } });
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
  });

  it("T21/T22 — unresolvable active pointer (findUnique returns null) -> SOURCE_MAPPING_UNAVAILABLE, no fallback query of any kind", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath();
    mappingVersionFindUniqueMock.mockResolvedValue(null);
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_MAPPING_UNAVAILABLE" });
    expect(mappingVersionFindUniqueMock).toHaveBeenCalledTimes(1);
  });
});

describe("selectWorksheetMapping — T28-T31 Upload state gate", () => {
  for (const status of ["IMPORTED", "SKIPPED", "INELIGIBLE"]) {
    it(`${status} -> WORKSHEET_NOT_ELIGIBLE, no batch lookup, no write`, async () => {
      const { selectWorksheetMapping } = await freshService();
      findFirstMock.mockResolvedValue(worksheetRow({ canonical_status: status }));
      const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
      expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
      expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
      expect(updateManyMock).not.toHaveBeenCalled();
    });
  }

  it("T31 — AWAITING_CONFIRMATION is allowed through to the write", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath();
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result.ok).toBe(true);
  });
});

describe("selectWorksheetMapping — T32/T33 conditional write count=0", () => {
  it("claim.count === 0 (lost a race) -> WORKSHEET_NOT_ELIGIBLE, not a raw exception", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath({ claimCount: 0 });
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
  });
});

describe("selectWorksheetMapping — deterministic T0/T1/T2/T3 write-boundary race proof", () => {
  // The T32/T33 test above proves the code's REACTION to claim.count === 0
  // is correct, but its mock unconditionally returns {count: 0} regardless
  // of what `where` argument the service actually passed — so it would
  // still pass even if the production WHERE clause silently dropped the
  // canonical_status condition. This test closes that gap: the mock below
  // behaves like a tiny real row, evaluating the SAME `where` object the
  // service really constructs against that row's REAL current state — the
  // same way a genuine Postgres `UPDATE ... WHERE` only touches rows that
  // still satisfy every one of its own conditions. A field absent from
  // `where` is treated as "no filter on this field" (matching Prisma's own
  // semantics), which is exactly what makes this test able to fail when a
  // condition is removed from the predicate, not merely when count is
  // hard-coded to 0.
  //
  // T0 selection begins (mockHappyPath's Step 1 findFirst already answers
  //     AWAITING_CONFIRMATION).
  // T1 all of the service's authoritative reads succeed (Steps 1-8, all
  //     mocked via mockHappyPath — nothing here is mutated).
  // T2 immediately before the mocked updateMany resolves, a "concurrent
  //     actor" (standing in for a real confirmWorksheet.ts claim) flips
  //     the row's REAL status to IMPORTED — modeling the exact moment a
  //     real concurrent transaction would have already committed between
  //     Step 1's read and this write.
  // T3 the service's own conditional write is evaluated against that now-
  //     changed real state. The required, falsifiable result: zero rows
  //     match, because the where clause's own canonical_status condition
  //     no longer agrees with reality.
  function rowAwareUpdateManyMock() {
    const realRow = { id: "worksheet-1", organisation_id: "org-1", lineage_kind: "DATA_HUB", canonical_status: "AWAITING_CONFIRMATION" as string };
    updateManyMock.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      // T2 — the race is won by someone else, immediately before this
      // mocked write is evaluated.
      realRow.canonical_status = "IMPORTED";

      // T3 — evaluate the service's ACTUAL where clause against the row's
      // real current state, field by field. A field absent from `where`
      // means "no filter" (matches Prisma's own semantics) — this is what
      // lets a weakened/removed predicate be caught below.
      const matches = (Object.keys(realRow) as (keyof typeof realRow)[]).every(
        (field) => !(field in args.where) || args.where[field] === realRow[field]
      );
      if (matches) {
        Object.assign(realRow, args.data);
      }
      return { count: matches ? 1 : 0 };
    });
    return realRow;
  }

  it("T51/T52/G/H — a state transition winning between the reads and the write makes the conditional write match zero rows; no stale success, no lineage write", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath();
    const realRow = rowAwareUpdateManyMock();

    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });

    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect((result as Record<string, unknown>).mappingVersionId).toBeUndefined();
    // The real row's lineage was never touched — the losing selection made
    // no change at all, exactly as a real Postgres UPDATE affecting zero
    // rows would leave the row untouched.
    expect((realRow as Record<string, unknown>).mapping_version_id).toBeUndefined();
    expect(realRow.canonical_status).toBe("IMPORTED");
  });
});

describe("selectWorksheetMapping — T23 idempotent reselection", () => {
  it("an identical repeat call while still AWAITING_CONFIRMATION succeeds again with the same result", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath();
    const first = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    const second = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(first).toEqual(second);
  });
});

// ─── Route-level static containment (T34-T37 auth, mass assignment, DELETE) ──

describe("mapping-selection route — auth/role/injection hardening", () => {
  const code = read(ROUTE_PATH);

  it("T34/T35/T36 — requires requireRole(\"manager\"), never a lower or higher bar", () => {
    expect(code).toMatch(/requireRole\(["']manager["']\)/);
    expect(code).not.toMatch(/requireRole\(["']admin["']\)/);
    expect(code).not.toMatch(/requireRole\(["']viewer["']\)/);
  });

  it("organisationId is derived exclusively from session.organisationId, never from the request body", () => {
    const stripped = stripComments(code);
    expect(stripped).toMatch(/session\.organisationId/);
    expect(stripped).not.toMatch(/body\.organisationId/);
  });

  it("the route hand-constructs its service input — never spreads the raw request body", () => {
    const stripped = stripComments(code);
    expect(stripped).not.toMatch(/\.\.\.\s*body\b/);
    expect(stripped).toMatch(/sourceMappingId:\s*body\.sourceMappingId/);
  });

  it("no other field name from the request body reaches the service call (mappingVersionId/sourceSystemId/organisationId/versionNumber/active/mappingDocument)", () => {
    const serviceCallBlock = code.match(/await selectWorksheetMapping\(\{[\s\S]*?\}\);/)?.[0] ?? "";
    for (const forbidden of ["mappingVersionId", "sourceSystemId", "organisationId: body", "versionNumber", "active:", "mappingDocument"]) {
      expect(serviceCallBlock).not.toMatch(new RegExp(forbidden));
    }
  });

  it("no DELETE handler exists in this route file", () => {
    expect(code).not.toMatch(/export\s+async\s+function\s+DELETE/);
  });

  it("no route file anywhere under app/api/data-hub/** implements a generic PATCH for Upload mapping lineage", () => {
    const uploadPatchFiles = fs
      .readdirSync(path.join(ROOT, "app", "api", "data-hub"), { recursive: true } as never)
      .filter((f): f is string => typeof f === "string" && f.endsWith("route.ts"))
      .filter((f) => {
        const full = read(path.join("app", "api", "data-hub", f));
        return /export\s+async\s+function\s+PATCH/.test(full) && /\bmapping_version_id\b|\bmappingVersionId\b/.test(full);
      });
    expect(uploadPatchFiles).toHaveLength(0);
  });
});

describe("confirm-illegal-dumping route — exhaustiveness extended for 5B.4B codes", () => {
  it("statusByCode maps SOURCE_MAPPING_UNAVAILABLE (still unreachable, compile-time exhaustiveness only) and SOURCE_LINEAGE_REQUIRED (409 — genuinely reachable since 6.0C1's own NULL-source gate)", () => {
    const code = read("app/api/data-hub/worksheets/[id]/confirm-illegal-dumping/route.ts");
    expect(code).toMatch(/SOURCE_LINEAGE_REQUIRED:\s*409/);
    expect(code).toMatch(/SOURCE_MAPPING_UNAVAILABLE:\s*500/);
  });

  // 6.0C1 — SOURCE_MAPPING_UNAVAILABLE remains genuinely non-emitting from
  // confirmDataHubWorksheet (this service still does not integrate mapping
  // SELECTION, only frozen mapping CONSUMPTION — a real, unchanged
  // invariant). SOURCE_LINEAGE_REQUIRED is the opposite: 6.0C1 deliberately,
  // newly authorizes confirmDataHubWorksheet to emit it (Step 3.5's
  // NULL-source fail-closed gate, required for the temporary first-import/
  // repeat-import safety invariant to be authoritative) — reusing the exact
  // existing code/semantics rather than inventing a duplicate one, per this
  // phase's own explicit instruction to prefer reuse.
  it("confirmDataHubWorksheet's own source never returns SOURCE_MAPPING_UNAVAILABLE (still proven non-emitting) but DOES now reference SOURCE_LINEAGE_REQUIRED (6.0C1)", () => {
    const code = stripComments(read(CONFIRM_SERVICE_PATH));
    expect(code).not.toMatch(/SOURCE_MAPPING_UNAVAILABLE/);
    expect(code).toMatch(/SOURCE_LINEAGE_REQUIRED/);
  });
});

describe("selectWorksheetMapping — T25/T26 freeze-on-write, not a live reference", () => {
  it("T25 — a resolved version at call time (v3) is what gets persisted, independent of any later pointer value", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath({ mapping: { active_mapping_version_id: "version-3" }, version: { id: "version-3", version_number: 3 } });
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: true, mappingVersionId: "version-3", versionNumber: 3 });
  });

  it("T26 — a later explicit reselection call resolves whatever is CURRENTLY active at that moment (v4)", async () => {
    const { selectWorksheetMapping } = await freshService();
    mockHappyPath({ mapping: { active_mapping_version_id: "version-4" }, version: { id: "version-4", version_number: 4 } });
    const result = await selectWorksheetMapping({ organisationId: "org-1", worksheetUploadId: "worksheet-1", sourceMappingId: "mapping-1" });
    expect(result).toMatchObject({ ok: true, mappingVersionId: "version-4", versionNumber: 4 });
  });
});
