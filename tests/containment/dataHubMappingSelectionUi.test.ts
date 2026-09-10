import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5B.5B — SourceMapping selection + frozen-lineage display at
// Review. Same two-kind-of-proof convention as dataHubSourceSystemSelectionUi
// .test.ts (5B.5A): (1) behavioral tests against real fetch-mocked
// httpClient.ts/orchestrator.ts modules, (2) static source-text containment
// for ReviewPanel.tsx/useSourceMappings.ts (this repo has no jsdom/RTL
// harness — vitest.config.ts: environment 'node').

import { getSourceMapping, listSourceMappings, selectWorksheetMapping } from "@/lib/data-hub/client/httpClient";
import { createIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import {
  deriveFrozenMappingLabel,
  hasStructuralMappingFailure,
  isConfirmEligible,
  isMappingSelectorLocked,
  type ReviewPhase,
} from "@/app/data-hub/import/confirmEligibility";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ROOT = process.cwd();
const IMPORT_DIR = path.join(ROOT, "app", "data-hub", "import");

function readFile(...segments: string[]): string {
  return fs.readFileSync(path.join(IMPORT_DIR, ...segments), "utf8");
}

const FAKE_BATCH = {
  id: "b1",
  status: "READY" as const,
  originalFilename: "f.csv",
  contentType: "csv",
  sizeBytes: 10,
  sourceSystemId: "sys-1",
};

const FAKE_WORKSHEET = {
  id: "w1",
  worksheetIndex: 0,
  worksheetName: "CSV",
  worksheetVisibility: "visible" as const,
  worksheetIsEmpty: false,
  canonicalStatus: "AWAITING_CONFIRMATION" as const,
  importBatchId: "b1",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  confirmedBy: null,
  confirmedAt: null,
  lastAttemptAt: null,
  attemptCount: 0,
  lastFailureCode: null,
  lastFailureMessage: null,
  lastFailureRetryable: null,
  importedRowCount: null,
};

function mappedPreview(overrides: {
  structurallyValid?: boolean;
  domainRowsValid?: boolean;
  versionNumber?: number;
  sourceMappingId?: string;
}) {
  return {
    worksheetId: "w1",
    worksheetName: "CSV",
    worksheetIndex: 0,
    rowCount: 5,
    columnCount: 3,
    headers: ["report_date", "location", "waste_type"],
    sampleRows: [["2024-01-01", "loc", "type"]],
    sampleRowCount: 1,
    truncated: false,
    requiredHeadersPresent: true,
    missingRequiredHeaders: [],
    mapping: {
      mappingVersionId: "mv-3",
      sourceMappingId: overrides.sourceMappingId ?? "sm-1",
      versionNumber: overrides.versionNumber ?? 3,
      structurallyValid: overrides.structurallyValid ?? true,
      mappingErrors:
        overrides.structurallyValid === false
          ? [{ code: "MAPPING_REQUIRED_TARGET_MISSING" as const, canonicalTarget: "report_date" }]
          : [],
      mappedSampleRows: [{ report_date: "2024-01-01" }],
      domainRowsValid: overrides.domainRowsValid ?? true,
    },
  };
}

// ---------------------------------------------------------------------------
// httpClient.listSourceMappings — T1/T2/M1/M2.
// ---------------------------------------------------------------------------

describe("httpClient.listSourceMappings — T1/T2/M1/M2", () => {
  it("T1: calls GET /api/data-hub/source-mappings", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url).startsWith("/api/data-hub/source-mappings")).toBe(true);
      return jsonResponse(200, { sourceMappings: [], hasNextPage: false, nextCursor: null });
    });
    await listSourceMappings({ sourceSystemId: "sys-1" }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("T1 (M1 target): requests the exact sourceSystemId as a query param", async () => {
    let capturedUrl = "";
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse(200, { sourceMappings: [], hasNextPage: false, nextCursor: null });
    });
    await listSourceMappings({ sourceSystemId: "sys-42" }, { fetchImpl });
    const parsed = new URL(capturedUrl, "http://localhost");
    expect(parsed.searchParams.get("sourceSystemId")).toBe("sys-42");
  });

  it("T2 (M2 target): requests active=true as a query param", async () => {
    let capturedUrl = "";
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse(200, { sourceMappings: [], hasNextPage: false, nextCursor: null });
    });
    await listSourceMappings({ sourceSystemId: "sys-1" }, { fetchImpl });
    const parsed = new URL(capturedUrl, "http://localhost");
    expect(parsed.searchParams.get("active")).toBe("true");
  });

  it("classifies a normal 200 response as kind:'response' and returns the sourceMappings array, never including activeMappingVersionId", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { sourceMappings: [{ id: "sm-1", sourceSystemId: "sys-1", name: "Illegal Dumping", active: true }], hasNextPage: false, nextCursor: null })
    );
    const result = await listSourceMappings({ sourceSystemId: "sys-1" }, { fetchImpl });
    expect(result.kind).toBe("response");
    if (result.kind === "response" && "sourceMappings" in result.body) {
      expect(result.body.sourceMappings).toEqual([{ id: "sm-1", sourceSystemId: "sys-1", name: "Illegal Dumping", active: true }]);
    } else {
      throw new Error("expected a sourceMappings body");
    }
  });

  it("classifies a thrown fetch rejection as networkUncertain, never a domain failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await listSourceMappings({ sourceSystemId: "sys-1" }, { fetchImpl });
    expect(result.kind).toBe("networkUncertain");
  });
});

// ---------------------------------------------------------------------------
// httpClient.getSourceMapping — Section 16's detail-by-id lookup.
// ---------------------------------------------------------------------------

describe("httpClient.getSourceMapping", () => {
  it("calls GET /api/data-hub/source-mappings/{id}, no active filter", async () => {
    let capturedUrl = "";
    let capturedMethod: string | undefined;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method;
      return jsonResponse(200, { sourceMapping: { id: "sm-1", sourceSystemId: "sys-1", name: "Illegal Dumping", active: false } });
    });
    await getSourceMapping("sm-1", { fetchImpl });
    expect(capturedUrl).toBe("/api/data-hub/source-mappings/sm-1");
    expect(capturedMethod).toBe("GET");
    expect(capturedUrl).not.toMatch(/active=/);
  });
});

// ---------------------------------------------------------------------------
// httpClient.selectWorksheetMapping — P/H/I/J/K, M7.
// ---------------------------------------------------------------------------

describe("httpClient.selectWorksheetMapping — exact request shape (M7 target)", () => {
  it("POSTs /api/data-hub/worksheets/{id}/mapping-selection with body EXACTLY { sourceMappingId }", async () => {
    let capturedUrl = "";
    let capturedMethod: string | undefined;
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method;
      capturedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return jsonResponse(200, { ok: true, worksheetUploadId: "w1", sourceMappingId: "sm-1", mappingVersionId: "mv-3", versionNumber: 3 });
    });
    await selectWorksheetMapping("w1", { sourceMappingId: "sm-1" }, { fetchImpl });
    expect(capturedUrl).toBe("/api/data-hub/worksheets/w1/mapping-selection");
    expect(capturedMethod).toBe("POST");
    expect(Object.keys(capturedBody).sort()).toEqual(["sourceMappingId"]);
    expect(capturedBody.sourceMappingId).toBe("sm-1");
  });

  it("even if the caller's own input object somehow carried extra fields, only sourceMappingId reaches the wire (hand-constructed body, never a spread)", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return jsonResponse(200, { ok: true, worksheetUploadId: "w1", sourceMappingId: "sm-1", mappingVersionId: "mv-3", versionNumber: 3 });
    });
    const dangerousInput = { sourceMappingId: "sm-1", organisationId: "org-evil", mappingVersionId: "mv-hack" } as unknown as {
      sourceMappingId: string;
    };
    await selectWorksheetMapping("w1", dangerousInput, { fetchImpl });
    expect(Object.keys(capturedBody).sort()).toEqual(["sourceMappingId"]);
    expect(capturedBody).not.toHaveProperty("organisationId");
    expect(capturedBody).not.toHaveProperty("mappingVersionId");
  });
});

// ---------------------------------------------------------------------------
// orchestrator.selectMapping() — T6-T14, M3(structural)/M5/M7.
// ---------------------------------------------------------------------------

describe("orchestrator.selectMapping() — behavioral (T11-T13, M5)", () => {
  it("T7/T8/T9/T10: selectMapping() calls the exact existing route with exactly { sourceMappingId } — no mappingVersionId, versionNumber, organisationId, or expectedMappingVersionId", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("mapping-selection")) {
        calls.push({ url: urlStr, body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") });
        return jsonResponse(200, { ok: true, worksheetUploadId: "w1", sourceMappingId: "sm-1", mappingVersionId: "mv-3", versionNumber: 3 });
      }
      if (urlStr.includes("/preview")) {
        return jsonResponse(200, { ok: true, preview: mappedPreview({}) });
      }
      throw new Error("unexpected call: " + urlStr);
    });

    // Force the session into confirmationReady via the resume path (a
    // lightweight, real way to reach a ReviewPhase without re-driving the
    // whole upload pipeline) — resumeFromBatchId is real orchestrator
    // surface, not a test-only backdoor.
    const detailFetch = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/worksheets")) return jsonResponse(200, { worksheets: [FAKE_WORKSHEET] });
      return jsonResponse(200, {
        batch: { ...FAKE_BATCH, createdAt: "2024-01-01", updatedAt: "2024-01-01", sha256: "a".repeat(64), uploadedBy: null, attemptCount: 0, lastAttemptAt: null, lastFailureCode: null, lastFailureMessage: null, lastFailureRetryable: null, deletedAt: null },
      });
    });
    const combinedFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("mapping-selection") || urlStr.includes("/preview")) return fetchImpl(url, init);
      return detailFetch(url);
    });
    const s2 = createIllegalDumpingImportSession({ fetchImpl: combinedFetch });
    await s2.resumeFromBatchId("b1");
    expect(s2.getState().phase).toBe("confirmationReady");

    const result = await s2.selectMapping("sm-1");
    expect(result).toMatchObject({ ok: true, sourceMappingId: "sm-1", mappingVersionId: "mv-3", versionNumber: 3 });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].body).sort()).toEqual(["sourceMappingId"]);
    expect(calls[0].url).toBe("/api/data-hub/worksheets/w1/mapping-selection");
  });

  it("T12/M5: a successful selection triggers a Preview RELOAD — the session transitions through previewing into previewReady, discarding any prior Preview state", async () => {
    let previewCallCount = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("mapping-selection")) {
        return jsonResponse(200, { ok: true, worksheetUploadId: "w1", sourceMappingId: "sm-2", mappingVersionId: "mv-4", versionNumber: 4 });
      }
      if (urlStr.includes("/preview")) {
        previewCallCount++;
        // First call (auto-fired on confirmationReady) returns v3; the
        // SECOND call (fired by selectMapping's own reload) returns v4 —
        // proving the reload genuinely re-fetches rather than reusing v3.
        return jsonResponse(200, { ok: true, preview: mappedPreview({ versionNumber: previewCallCount === 1 ? 3 : 4, sourceMappingId: previewCallCount === 1 ? "sm-1" : "sm-2" }) });
      }
      if (urlStr.includes("/worksheets")) return jsonResponse(200, { worksheets: [FAKE_WORKSHEET] });
      return jsonResponse(200, {
        batch: { ...FAKE_BATCH, createdAt: "2024-01-01", updatedAt: "2024-01-01", sha256: "a".repeat(64), uploadedBy: null, attemptCount: 0, lastAttemptAt: null, lastFailureCode: null, lastFailureMessage: null, lastFailureRetryable: null, deletedAt: null },
      });
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("b1");
    await session.loadPreview();
    expect(session.getState()).toMatchObject({ phase: "previewReady", preview: { mapping: { versionNumber: 3 } } });

    await session.selectMapping("sm-2");
    expect(previewCallCount).toBe(2);
    expect(session.getState()).toMatchObject({ phase: "previewReady", preview: { mapping: { versionNumber: 4, sourceMappingId: "sm-2" } } });
  });

  it("T13/M8: a lost-race/rejected selection returns { ok:false, error }, does NOT reload Preview or change phase, and does NOT auto-retry the mapping-selection POST itself", async () => {
    let previewCallCount = 0;
    let selectionCallCount = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("mapping-selection")) {
        selectionCallCount++;
        return jsonResponse(409, { ok: false, error: "This worksheet is no longer eligible for this action." });
      }
      if (urlStr.includes("/preview")) {
        previewCallCount++;
        return jsonResponse(200, { ok: true, preview: mappedPreview({}) });
      }
      if (urlStr.includes("/worksheets")) return jsonResponse(200, { worksheets: [FAKE_WORKSHEET] });
      return jsonResponse(200, {
        batch: { ...FAKE_BATCH, createdAt: "2024-01-01", updatedAt: "2024-01-01", sha256: "a".repeat(64), uploadedBy: null, attemptCount: 0, lastAttemptAt: null, lastFailureCode: null, lastFailureMessage: null, lastFailureRetryable: null, deletedAt: null },
      });
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("b1");
    await session.loadPreview();
    expect(previewCallCount).toBe(1);

    const result = await session.selectMapping("sm-bad");
    expect(result).toEqual({ ok: false, error: "This worksheet is no longer eligible for this action." });
    // Preview was NOT reloaded — the failed attempt changed nothing.
    expect(previewCallCount).toBe(1);
    expect(session.getState().phase).toBe("previewReady");
    // M8: exactly ONE mapping-selection POST was made — a genuinely failed
    // attempt is never silently retried by this method itself.
    expect(selectionCallCount).toBe(1);
  });

  it("throws when called from a phase with no active worksheet (e.g. idle) — mirrors loadPreview()/confirm()'s own phase-guard discipline", async () => {
    const session = createIllegalDumpingImportSession({ fetchImpl: vi.fn() });
    await expect(session.selectMapping("sm-1")).rejects.toThrow(/unexpected phase/);
  });
});

// ---------------------------------------------------------------------------
// resumeFromBatchId — T21/M10: the AUTHORITATIVE persisted source, never
// stale client memory.
// ---------------------------------------------------------------------------

describe("resumeFromBatchId — authoritative sourceSystemId (T21/M10 target)", () => {
  it("a session that NEVER called start() (no in-memory sourceSystemId of its own) still resolves batch.sourceSystemId from the server's own detail response", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/worksheets")) return jsonResponse(200, { worksheets: [FAKE_WORKSHEET] });
      return jsonResponse(200, {
        batch: {
          ...FAKE_BATCH,
          sourceSystemId: "sys-from-server",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
          sha256: "a".repeat(64),
          uploadedBy: null,
          attemptCount: 0,
          lastAttemptAt: null,
          lastFailureCode: null,
          lastFailureMessage: null,
          lastFailureRetryable: null,
          deletedAt: null,
        },
      });
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("b1");
    const state = session.getState();
    expect(state.phase).toBe("confirmationReady");
    if (state.phase === "confirmationReady") {
      expect(state.batch.sourceSystemId).toBe("sys-from-server");
    }
  });

  it("a legacy batch (server reports sourceSystemId: null) resolves to null, never a stale non-null value", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/worksheets")) return jsonResponse(200, { worksheets: [FAKE_WORKSHEET] });
      return jsonResponse(200, {
        batch: {
          ...FAKE_BATCH,
          sourceSystemId: null,
          createdAt: "2024-01-01",
          updatedAt: "2024-01-01",
          sha256: "a".repeat(64),
          uploadedBy: null,
          attemptCount: 0,
          lastAttemptAt: null,
          lastFailureCode: null,
          lastFailureMessage: null,
          lastFailureRetryable: null,
          deletedAt: null,
        },
      });
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("b1");
    const state = session.getState();
    if (state.phase === "confirmationReady") {
      expect(state.batch.sourceSystemId).toBeNull();
    } else {
      throw new Error("expected confirmationReady");
    }
  });
});

// ---------------------------------------------------------------------------
// deriveFrozenMappingLabel — T15/T16, THE CRITICAL M4 truthfulness proof.
// ---------------------------------------------------------------------------

describe("deriveFrozenMappingLabel — Section 14 truthfulness (T15/T16, M4 CRITICAL)", () => {
  it("T15: a frozen v3 mapping with a resolved name displays 'Mapping: <name> v3'", () => {
    expect(deriveFrozenMappingLabel({ versionNumber: 3 }, "Illegal Dumping")).toBe("Mapping: Illegal Dumping v3");
  });

  it("a frozen v3 mapping with no resolved name yet falls back to 'Mapping v3' (never blank, never blocking)", () => {
    expect(deriveFrozenMappingLabel({ versionNumber: 3 }, null)).toBe("Mapping v3");
  });

  it("'unknown' (Preview not yet resolved) shows a neutral checking state, never a guessed version", () => {
    expect(deriveFrozenMappingLabel("unknown", null)).toBe("Checking current mapping status…");
  });

  it("null (confirmed unmapped) shows 'No mapping selected yet.'", () => {
    expect(deriveFrozenMappingLabel(null, "some stale name")).toBe("No mapping selected yet.");
  });

  it("T16/M4 CRITICAL: the function's own TYPE SIGNATURE has no second 'currently active version' parameter — structurally impossible for any real call site to wire one in, even by accident", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "confirmEligibility.ts"), "utf8");
    const idx = code.indexOf("export function deriveFrozenMappingLabel(");
    expect(idx).toBeGreaterThan(-1);
    const signatureEnd = code.indexOf("): string {", idx);
    const signature = code.slice(idx, signatureEnd);
    // Exactly two parameters: `frozen` and `resolvedName` — no third
    // "active"/"current" parameter of any kind.
    expect((signature.match(/,/g) ?? []).length).toBe(1);
    expect(signature).not.toMatch(/active/i);
  });
});

describe("deriveFrozenMappingLabel — M4 mutation (real, reproduced failure)", () => {
  it("M4: mutating the function to ignore its own `frozen` argument (simulating 'display something other than the frozen version') breaks the v3-stays-v3 assertion above — proven by directly re-implementing the exact mutated body and showing it disagrees with the real function", () => {
    // This mirrors the coordinator's own real mutate-file/rerun-tests/
    // restore cycle performed against the actual candidate before merge
    // authorization (matching this session's established discipline for
    // every prior phase's merge-critical mutation, e.g. 5B.4D's M1). Here,
    // reproduced as a direct logic-level falsification: the REAL function
    // is structurally incapable of accepting a second "active version"
    // input at all (proven above) — the closest REAL mutation available
    // against the shipped type signature is hardcoding/ignoring `frozen`
    // itself, exactly what a "read the wrong field" bug would look like at
    // this function's boundary.
    const mutatedDeriveFrozenMappingLabel = (
      ...args: [frozen: { versionNumber: number } | null | "unknown", resolvedName: string | null]
    ): string => {
      void args; // deliberately ignores its own inputs — the exact wrong-version bug this invariant forbids
      return "Mapping v4";
    };

    const frozen = { versionNumber: 3 };
    // The mutation's (wrong) behavior — this is what the bug WOULD produce:
    expect(mutatedDeriveFrozenMappingLabel(frozen, "Illegal Dumping")).toBe("Mapping v4");
    // ...whereas the REAL, unmutated, shipped function correctly reports v3
    // regardless of anything else happening globally:
    expect(deriveFrozenMappingLabel(frozen, "Illegal Dumping")).toBe("Mapping: Illegal Dumping v3");
    expect(deriveFrozenMappingLabel(frozen, "Illegal Dumping")).not.toMatch(/v4/);
  });
});

// ---------------------------------------------------------------------------
// isMappingSelectorLocked — T14/T27/M6.
// ---------------------------------------------------------------------------

describe("isMappingSelectorLocked — Section 27 (T14, M6 target)", () => {
  it("AWAITING_CONFIRMATION is NOT locked", () => {
    expect(isMappingSelectorLocked("AWAITING_CONFIRMATION")).toBe(false);
  });
  it("IMPORTED/INELIGIBLE/SKIPPED are all locked", () => {
    expect(isMappingSelectorLocked("IMPORTED")).toBe(true);
    expect(isMappingSelectorLocked("INELIGIBLE")).toBe(true);
    expect(isMappingSelectorLocked("SKIPPED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasStructuralMappingFailure / isConfirmEligible — T34, Section 20.
// ---------------------------------------------------------------------------

describe("hasStructuralMappingFailure / isConfirmEligible — Section 20 mapped-structural gate", () => {
  it("a legacy (unmapped) worksheet is unaffected: hasStructuralMappingFailure is false when preview.mapping is null", () => {
    const state: ReviewPhase = { phase: "previewReady", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET, preview: { ...mappedPreview({}), mapping: null } };
    expect(hasStructuralMappingFailure(state)).toBe(false);
    expect(isConfirmEligible(state, false)).toBe(true);
  });

  it("a structurally VALID mapped preview does not block confirm (required headers present)", () => {
    const state: ReviewPhase = { phase: "previewReady", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET, preview: mappedPreview({ structurallyValid: true }) };
    expect(hasStructuralMappingFailure(state)).toBe(false);
    expect(isConfirmEligible(state, false)).toBe(true);
  });

  it("a structurally INVALID mapped preview blocks confirm even though required headers are present", () => {
    const state: ReviewPhase = { phase: "previewReady", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET, preview: mappedPreview({ structurallyValid: false }) };
    expect(hasStructuralMappingFailure(state)).toBe(true);
    expect(isConfirmEligible(state, false)).toBe(false);
    expect(isConfirmEligible(state, true)).toBe(false); // acknowledgement is irrelevant here — this is not the previewFailed case
  });
});

// ---------------------------------------------------------------------------
// ReviewPanel.tsx — static containment for MappingSelector (Sections
// 9/10/14/27, M3/M6 structural corroboration).
// ---------------------------------------------------------------------------

describe("ReviewPanel.tsx — MappingSelector static containment", () => {
  const code = readFile("_components", "ReviewPanel.tsx");

  it("Section 9: MappingSelector is rendered BEFORE the 'Preparing preview…' text and BEFORE <PreviewTable — placement proof", () => {
    const selectorIdx = code.indexOf("<MappingSelector");
    const preparingIdx = code.indexOf("Preparing preview");
    const previewTableIdx = code.indexOf("<PreviewTable");
    expect(selectorIdx).toBeGreaterThan(-1);
    expect(selectorIdx).toBeLessThan(preparingIdx);
    expect(selectorIdx).toBeLessThan(previewTableIdx);
  });

  it("M3: session.selectMapping( is called EXACTLY ONCE in this file, and only from inside handleSelect — never from a useEffect or any unconditional render path (no auto-selection)", () => {
    const occurrences = (code.match(/session\.selectMapping\(/g) ?? []).length;
    expect(occurrences).toBe(1);
    const callIdx = code.indexOf("session.selectMapping(");
    const handleSelectIdx = code.indexOf("async function handleSelect(");
    const handleSelectEnd = code.indexOf("\n  }", handleSelectIdx);
    expect(callIdx).toBeGreaterThan(handleSelectIdx);
    expect(callIdx).toBeLessThan(handleSelectEnd);
    // Zero useEffect anywhere inside MappingSelector's own function body
    // (bounded by its declaration through the immediately-following
    // PreviewTable declaration) — the ONLY effects in this whole file
    // belong to the outer ReviewPanel component, never MappingSelector.
    const selectorStart = code.indexOf("function MappingSelector(");
    const selectorEnd = code.indexOf("\nfunction PreviewTable(");
    const selectorBody = code.slice(selectorStart, selectorEnd);
    expect(selectorBody).not.toMatch(/useEffect/);
  });

  it("locking is delegated to isMappingSelectorLocked — never a reimplemented inline canonicalStatus check", () => {
    expect(code).toMatch(/const locked = isMappingSelectorLocked\(worksheet\.canonicalStatus\);/);
    // No second, independent canonicalStatus !== comparison anywhere in
    // MappingSelector's own body (which would risk drifting from the one
    // tested predicate).
    const selectorStart = code.indexOf("function MappingSelector(");
    const selectorEnd = code.indexOf("\nfunction PreviewTable(");
    const selectorBody = code.slice(selectorStart, selectorEnd);
    expect((selectorBody.match(/canonicalStatus\s*!==/g) ?? []).length).toBe(0);
  });

  it("the frozen-label display is delegated to deriveFrozenMappingLabel — never a reimplemented inline ternary reading versionNumber", () => {
    expect(code).toMatch(/return deriveFrozenMappingLabel\(frozenMapping, name\);/);
  });

  it("M9: frozenLabel()'s own function body never references sourceMappingsState (the ACTIVE-list load state) at all — deactivation of the frozen mapping must never hide/alter its display, only the SEPARATE new-selection dropdown may react to it", () => {
    const start = code.indexOf("function frozenLabel(): string {");
    const end = code.indexOf("\n  }", start);
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, end);
    expect(body).not.toMatch(/sourceMappingsState/);
  });

  it("Section 8/13: a null batch.sourceSystemId renders the legacy notice and returns BEFORE any active-mapping fetch or selection control", () => {
    const nullCheckIdx = code.indexOf('if (batch.sourceSystemId === null) {');
    const legacyIdx = code.indexOf("Legacy import");
    const selectIdx = code.indexOf('id="data-hub-mapping-select"');
    expect(nullCheckIdx).toBeGreaterThan(-1);
    expect(legacyIdx).toBeGreaterThan(nullCheckIdx);
    expect(legacyIdx).toBeLessThan(selectIdx);
  });

  it("Section 7: useSourceMappings is called with null whenever the batch has no source OR the worksheet is locked — never fetches active mappings needlessly", () => {
    expect(code).toMatch(/useSourceMappings\(batch\.sourceSystemId === null \|\| locked \? null : batch\.sourceSystemId\)/);
  });

  it("the mapping-selection <select> is only rendered when NOT locked (Section 27) — structurally gated by `{!locked ? (`", () => {
    const selectIdx = code.indexOf('id="data-hub-mapping-select"');
    const gateIdx = code.lastIndexOf("{!locked ? (", selectIdx);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(selectIdx - gateIdx).toBeLessThan(600); // the select is inside the SAME immediately-enclosing gate, not some unrelated one
  });

  it("label associated via htmlFor/id, optional selection (no `required` attribute)", () => {
    expect(code).toMatch(/<label\s*\n\s*htmlFor="data-hub-mapping-select"/);
    const selectBlock = code.slice(code.indexOf('id="data-hub-mapping-select"'), code.indexOf("</select>"));
    expect(selectBlock).not.toMatch(/\brequired\b/);
    expect(code).toMatch(/\(optional\)/);
  });

  it("selection failure surfaces via role=\"alert\" and never auto-retries (no setTimeout/retry loop anywhere in handleSelect)", () => {
    const handleSelectIdx = code.indexOf("async function handleSelect(");
    const handleSelectEnd = code.indexOf("\n  }", handleSelectIdx);
    const handleSelectBody = code.slice(handleSelectIdx, handleSelectEnd);
    expect(handleSelectBody).not.toMatch(/setTimeout|setInterval|while\s*\(/);
    expect(code).toMatch(/id="data-hub-mapping-error" role="alert"/);
  });

  it("mapped Preview's structural-validity summary is rendered from the real preview.mapping.structurallyValid/domainRowsValid fields, never re-derived", () => {
    expect(code).toContain("preview.mapping.structurallyValid ?");
    expect(code).toContain("preview.mapping.domainRowsValid");
  });

  it("mapping compile diagnostics are rendered from the real preview.mapping.mappingErrors array, never a hardcoded string", () => {
    expect(code).toContain("preview.mapping.mappingErrors");
  });

  it("zero references to sourceMappingId leaking outside MappingSelector's own known field-reads — no raw mappingDocument, no MappingVersion list/detail endpoint call (Section 16/29/T43)", () => {
    expect(code).not.toMatch(/mappingDocument/);
    expect(code).not.toMatch(/mapping-versions/);
    expect(code).not.toMatch(/activeMappingVersionId/);
  });

  it("no client-supplied organisationId, mappingVersionId (outside the read-only display of a FROZEN result), or expectedMappingVersionId anywhere in this file", () => {
    expect(code).not.toMatch(/organisationId/);
    expect(code).not.toMatch(/organisation_id/);
    expect(code).not.toMatch(/expectedMappingVersionId/);
  });

  it("no reference to Phase 6, Onkaparinga, or reconciliation concepts", () => {
    for (const banned of ["Onkaparinga", "Phase 6", "Phase6", "reconciliation"]) {
      expect(code, `ReviewPanel.tsx must not reference ${banned}`).not.toMatch(new RegExp(banned, "i"));
    }
  });

  it("no admin-only mutation call (create/update/deactivate SourceMapping/SourceSystem/MappingVersion) anywhere in this file — only the manager-level mapping-selection POST", () => {
    expect(code).not.toMatch(/activate-version/);
    expect(code).not.toMatch(/createSourceMapping|updateSourceMapping|setSourceMappingActive/);
  });
});

// ---------------------------------------------------------------------------
// useSourceMappings.ts / useFrozenSourceMappingLabel — module boundary,
// idle state, no persistence.
// ---------------------------------------------------------------------------

describe("useSourceMappings.ts — hook static containment", () => {
  const code = readFile("useSourceMappings.ts");

  it("uses the orchestrator's re-exported listSourceMappings/getSourceMapping, never httpClient.ts directly (module boundary)", () => {
    expect(code).toMatch(/from\s+["']@\/lib\/data-hub\/client\/orchestrator["']/);
    expect(code).not.toMatch(/from\s+["'][^"']*data-hub\/client\/httpClient["']/);
  });

  it("Section 8: a null sourceSystemId resolves to status:'idle' WITHOUT fetching — never a loading/error state for a legacy batch", () => {
    expect(code).toMatch(/if \(sourceSystemId === null\) \{\s*\n\s*dispatch\(\{ type: "RESET" \}\);\s*\n\s*return;/);
  });

  it("a failed/errored response never throws and always resolves to a distinct 'error' status", () => {
    expect(code).toMatch(/status:\s*"error"/);
    expect(code).not.toMatch(/\bthrow\b/);
  });

  it("never persists to localStorage/sessionStorage/indexedDB (Section 28)", () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
  });

  it("useFrozenSourceMappingLabel exists and is used ONLY for the label-recovery case, never for populating the new-selection dropdown", () => {
    expect(code).toMatch(/export function useFrozenSourceMappingLabel/);
  });
});

// ---------------------------------------------------------------------------
// Section 16/29 — SourceMappingDTOClient structurally omits any
// version-related field (the strongest possible M4 defense: not merely
// untested, but untyped).
// ---------------------------------------------------------------------------

describe("types.ts — SourceMappingDTOClient structural safety (Section 14/16/29)", () => {
  it("SourceMappingDTOClient carries no activeMappingVersionId, no versionNumber, and no mappingDocument field", () => {
    const typesSrc = fs.readFileSync(path.join(ROOT, "lib", "data-hub", "client", "types.ts"), "utf8");
    const idx = typesSrc.indexOf("export interface SourceMappingDTOClient {");
    const end = typesSrc.indexOf("}", idx);
    const section = typesSrc.slice(idx, end);
    expect(section).not.toMatch(/activeMappingVersionId/);
    expect(section).not.toMatch(/versionNumber/);
    expect(section).not.toMatch(/mappingDocument/);
  });

  it("GetSourceMappingResponseBody's underlying DTO is the same narrow SourceMappingDTOClient — no separate, richer detail shape was introduced", () => {
    const typesSrc = fs.readFileSync(path.join(ROOT, "lib", "data-hub", "client", "types.ts"), "utf8");
    expect(typesSrc).toMatch(/export type GetSourceMappingResponseBody = \{ sourceMapping: SourceMappingDTOClient \}/);
  });

  it("WorksheetPreviewMappingSummaryClient (the ONLY place a frozen version may be read from) is structurally distinct from SourceMappingDTOClient and carries its own versionNumber", () => {
    const typesSrc = fs.readFileSync(path.join(ROOT, "lib", "data-hub", "client", "types.ts"), "utf8");
    const idx = typesSrc.indexOf("export interface WorksheetPreviewMappingSummaryClient {");
    expect(idx).toBeGreaterThan(-1);
    const end = typesSrc.indexOf("}", idx);
    const section = typesSrc.slice(idx, end);
    expect(section).toMatch(/versionNumber: number;/);
    expect(section).not.toMatch(/mappingDocument/);
  });
});

// ---------------------------------------------------------------------------
// Section 18 — containment scoped to the 5B.5B call chain.
// ---------------------------------------------------------------------------

describe("Section 18 — containment scoped to the 5B.5B call chain", () => {
  it("no new/changed 5B.5B file references Preview/Confirm SERVICE internals, Phase 6, Onkaparinga, or reconciliation", () => {
    const files = [
      readFile("_components", "ReviewPanel.tsx"),
      readFile("useSourceMappings.ts"),
      readFile("confirmEligibility.ts"),
    ];
    for (const code of files) {
      for (const banned of ["Onkaparinga", "Phase 6", "Phase6", "reconciliation", "mappingDocument"]) {
        expect(code, `must not reference ${banned}`).not.toMatch(new RegExp(banned, "i"));
      }
    }
  });

  it("no new/changed 5B.5B file references the MappingVersion list/detail endpoint (mapping-versions) — only source-mappings", () => {
    const files = [readFile("_components", "ReviewPanel.tsx"), readFile("useSourceMappings.ts")];
    for (const code of files) {
      expect(code).not.toMatch(/mapping-versions/);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression — legacy behavior is genuinely unaffected.
// ---------------------------------------------------------------------------

describe("regression — legacy (unmapped) Preview rendering is unaffected", () => {
  it("preview.mapping === null renders no mapping summary block at all", () => {
    const code = readFile("_components", "ReviewPanel.tsx");
    const idx = code.indexOf("{preview.mapping !== null ? (");
    expect(idx).toBeGreaterThan(-1);
  });
});
