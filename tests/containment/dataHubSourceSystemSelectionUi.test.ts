import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5B.5A — SourceSystem selection at import initiation. Two kinds
// of proof, matching this repo's established Data Hub client convention:
//   1. Behavioral tests against listSourceSystems (httpClient.ts) and the
//      orchestrator's initiate-body threading (orchestrator.ts) — both are
//      plain, DOM-free modules, so real fetch-mock behavioral proof applies
//      exactly as dataHubClientHttpClient.test.ts / dataHubClientOrchestrator
//      .test.ts already do.
//   2. Static source-text containment for FileSelector.tsx/useSourceSystems.ts
//      — this repo has no jsdom/React Testing Library harness
//      (vitest.config.ts: environment 'node'), so rendered-DOM behavior for
//      states (loading/zero/one/multiple/error) is proven structurally, the
//      same limitation dataHubImportContainment.test.ts's own header comment
//      already documents for every other screen in this directory.

import { listSourceSystems } from "@/lib/data-hub/client/httpClient";
import { createIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ROOT = process.cwd();
const IMPORT_DIR = path.join(ROOT, "app", "data-hub", "import");

function readFile(...segments: string[]): string {
  return fs.readFileSync(path.join(IMPORT_DIR, ...segments), "utf8");
}

// ---------------------------------------------------------------------------
// A/B — httpClient.listSourceSystems uses the existing manager read
// endpoint and always requests active=true.
// ---------------------------------------------------------------------------

describe("httpClient.listSourceSystems — A/B", () => {
  it("A: calls GET /api/data-hub/source-systems", async () => {
    let calledUrl = "";
    let calledMethod: string | undefined;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(url);
      calledMethod = init?.method;
      return jsonResponse(200, { sourceSystems: [], hasNextPage: false, nextCursor: null });
    });
    await listSourceSystems({}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calledUrl.startsWith("/api/data-hub/source-systems")).toBe(true);
    expect(calledMethod).toBe("GET");
  });

  it("B: requests active=true as a query param (M1 target)", async () => {
    let capturedUrl = "";
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse(200, { sourceSystems: [], hasNextPage: false, nextCursor: null });
    });
    await listSourceSystems({}, { fetchImpl });
    // Assertion made AFTER the call, never inside the mock — see
    // dataHubClientHttpClient.test.ts's own established comment on why an
    // in-mock assertion throw would be silently swallowed as
    // networkUncertain rather than actually failing this test.
    const parsed = new URL(capturedUrl, "http://localhost");
    expect(parsed.searchParams.get("active")).toBe("true");
  });

  it("classifies a normal 200 response as kind:'response' and returns the sourceSystems array", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { sourceSystems: [{ id: "s1", name: "TechnologyOne", description: null, active: true }], hasNextPage: false, nextCursor: null })
    );
    const result = await listSourceSystems({}, { fetchImpl });
    expect(result.kind).toBe("response");
    if (result.kind === "response" && "sourceSystems" in result.body) {
      expect(result.body.sourceSystems).toEqual([{ id: "s1", name: "TechnologyOne", description: null, active: true }]);
    } else {
      throw new Error("expected a sourceSystems body");
    }
  });

  it("classifies a thrown fetch rejection as networkUncertain, never a domain failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await listSourceSystems({}, { fetchImpl });
    expect(result.kind).toBe("networkUncertain");
  });
});

// ---------------------------------------------------------------------------
// F/G/H/I/J/K/Q — orchestrator initiate-body threading.
// ---------------------------------------------------------------------------

describe("orchestrator — SourceSystem threading into initiate body (F/G/H/I/J/K/Q)", () => {
  function captureInitiateBody(): { fetchImpl: typeof fetch; getBody: () => Record<string, unknown> } {
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
      // configurationError:true short-circuits the orchestrator before any
      // upload attempt — exactly one fetch call is made, keeping this test
      // focused purely on the initiate request itself.
      return jsonResponse(200, {
        batch: { id: "b1", status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
        uploadToken: null,
        configurationError: true,
      });
    });
    return { fetchImpl, getBody: () => JSON.parse(capturedBody ?? "{}") };
  }

  const testFile = () => new File(["a,b\n1,2\n"], "dumping.csv", { type: "text/csv" });

  it("F: a selected sourceSystemId reaches the exact initiate request body", async () => {
    const { fetchImpl, getBody } = captureInitiateBody();
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile(), { sourceSystemId: "sys-123" });
    expect(getBody().sourceSystemId).toBe("sys-123");
  });

  it("G: no selection causes sourceSystemId to be OMITTED from the serialized body — not null, not \"\", not the string \"undefined\"", async () => {
    const { fetchImpl, getBody } = captureInitiateBody();
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile(), {});
    const body = getBody();
    expect("sourceSystemId" in body).toBe(false);
  });

  it("G (equivalent): omitting the options object entirely produces the same omitted-field body as pre-5B.5A", async () => {
    const { fetchImpl, getBody } = captureInitiateBody();
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    const body = getBody();
    expect("sourceSystemId" in body).toBe(false);
    // Pre-5B.5A shape is exactly these two keys (idempotencyKey travels as
    // a header, never the JSON body — see httpClient.ts's own
    // InitiateCallInput comment) — proves this slice added no other field
    // to the body by accident.
    expect(Object.keys(body).sort()).toEqual(["declaredSizeBytes", "originalFilename"].sort());
  });

  it("H/I/J/K: no organisationId, sourceMappingId, mappingVersionId, or expectedMappingVersionId is ever sent, selected or not", async () => {
    const { fetchImpl, getBody } = captureInitiateBody();
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile(), { sourceSystemId: "sys-123" });
    const body = getBody();
    expect(body).not.toHaveProperty("organisationId");
    expect(body).not.toHaveProperty("sourceMappingId");
    expect(body).not.toHaveProperty("mappingVersionId");
    expect(body).not.toHaveProperty("expectedMappingVersionId");
  });

  it("Q: retryInitiate() reuses the SAME sourceSystemId captured at start() — there is no method that changes it after the fact", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
      return jsonResponse(200, {
        batch: { id: "b1", status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
        uploadToken: null,
        configurationError: true,
      });
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile(), { sourceSystemId: "sys-fixed" });
    await session.retryInitiate();
    expect(bodies).toHaveLength(2);
    expect(bodies[0].sourceSystemId).toBe("sys-fixed");
    expect(bodies[1].sourceSystemId).toBe("sys-fixed");
    // Structural proof (not merely behavioral): DataHubIllegalDumpingImportSession
    // exposes no public method whose name suggests changing the source
    // system after start() — the only way to change it is a brand-new
    // start() call, which is a brand-new logical batch.
    const orchestratorSrc = fs.readFileSync(
      path.join(ROOT, "lib", "data-hub", "client", "orchestrator.ts"),
      "utf8"
    );
    const publicMethodNames = [...orchestratorSrc.matchAll(/^\s{2}(?:async\s+)?([a-zA-Z]+)\(/gm)].map((m) => m[1]);
    expect(publicMethodNames.some((n) => /sourceSystem/i.test(n))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C/D/E/L/M/N/O/P/R/W/AccessibilityHooks — static containment for
// FileSelector.tsx / useSourceSystems.ts.
// ---------------------------------------------------------------------------

describe("FileSelector.tsx — SourceSystem control static containment", () => {
  const code = readFile("_components", "FileSelector.tsx");

  it("L/W: the control is a native <select>, labelled 'Source System', associated via htmlFor/id", () => {
    expect(code).toMatch(/<label\s+htmlFor="data-hub-source-system-select"/);
    expect(code).toMatch(/id="data-hub-source-system-select"/);
    expect(code).toContain("Source System");
  });

  it("optional selection: the control's label text says (optional), and no HTML `required` attribute is present on the select", () => {
    expect(code).toMatch(/Source System[\s\S]{0,200}\(optional\)/);
    const selectBlock = code.slice(code.indexOf("<select"), code.indexOf("</select>"));
    expect(selectBlock).not.toMatch(/\brequired\b/);
  });

  it("M: loading state disables the select and shows a distinct loading option, never a blank/frozen control", () => {
    expect(code).toMatch(/disabled=\{sourceSystemsState\.status === "loading"\}/);
    expect(code).toMatch(/Loading source systems…/);
  });

  it("N: zero-results state shows an explicit empty-state message and legacy import remains available (no 'required' gating anywhere near it)", () => {
    const idx = code.indexOf("No source systems are configured yet");
    expect(idx).toBeGreaterThan(-1);
    expect(code.slice(idx, idx + 120)).toMatch(/continue without selecting/);
  });

  it("R: the legacy/no-source option is always the first, always-present <option>, independent of load status", () => {
    expect(code).toMatch(/<option value=\{NO_SOURCE_SYSTEM_VALUE\}>No source system \(legacy import\)<\/option>/);
  });

  it("O: the pendingFile driven Start-import button disabled attribute is untouched by SourceSystem load status — depends ONLY on pendingFile (M5 target)", () => {
    const buttonIdx = code.indexOf("Start import");
    const buttonBlockStart = code.lastIndexOf("<button", buttonIdx);
    const buttonBlock = code.slice(buttonBlockStart, buttonIdx);
    expect(buttonBlock).toMatch(/disabled=\{!pendingFile\}/);
    expect(buttonBlock).not.toMatch(/sourceSystemsState/);
  });

  it("P: post-initiation immutability — start() is the only call site that reads selectedSourceSystemId, and it is passed only inside the options object of session.start(), never assigned back after the call", () => {
    const occurrences = (code.match(/selectedSourceSystemId/g) ?? []).length;
    // Declaration, the <select>'s value prop, the ternary read inside
    // start(), and the object-literal value passed to session.start() —
    // exactly 4 (case-sensitive; distinct from setSelectedSourceSystemId's
    // capital-S "Selected", which this pattern deliberately does not
    // match), proven exhaustively rather than "at least N" so a NEW,
    // unreviewed read of this state (e.g. a second call site that could
    // re-send a changed value after the batch already exists) is caught by
    // this test.
    expect(occurrences).toBe(4);
    expect(code).toMatch(/session\.start\(\s*pendingFile,\s*\n\s*selectedSourceSystemId === NO_SOURCE_SYSTEM_VALUE/);
  });

  it("M4 guard: the one-source auto-pre-select render-time adjustment fires ONLY when the list resolved to EXACTLY one system", () => {
    const idx = code.indexOf("!hasAppliedSingleSourceDefault &&");
    expect(idx).toBeGreaterThan(-1);
    const block = code.slice(idx, idx + 200);
    expect(block).toMatch(/sourceSystemsState\.sourceSystems\.length\s*===\s*1/);
  });

  it("zero references to sourceMappingId/mappingVersionId/expectedMappingVersionId/mappingDocument/organisationId anywhere in this file (Section 18 containment)", () => {
    for (const banned of ["sourceMappingId", "mappingVersionId", "expectedMappingVersionId", "mappingDocument", "organisationId", "organisation_id"]) {
      expect(code, `FileSelector.tsx must not reference ${banned}`).not.toMatch(new RegExp(banned));
    }
  });

  it("zero references to Preview/Confirm mapping-selection, Phase 6, Onkaparinga, or reconciliation concepts", () => {
    for (const banned of ["mapping-selection", "reconciliation", "Onkaparinga", "Phase 6", "Phase6"]) {
      expect(code, `FileSelector.tsx must not reference ${banned}`).not.toMatch(new RegExp(banned, "i"));
    }
  });

  it("no automatic source recognition: the file's own name/content is never inspected to choose a SourceSystem", () => {
    // handleFile/handleChange/handleDrop only ever call validateSelectedFile
    // and setPendingFile — never touch selectedSourceSystemId or the
    // sourceSystems list at all.
    const handleFileIdx = code.indexOf("function handleFile(");
    const handleFileEnd = code.indexOf("\n  }", handleFileIdx);
    const handleFileBody = code.slice(handleFileIdx, handleFileEnd);
    expect(handleFileBody).not.toMatch(/sourceSystem/i);
  });
});

describe("useSourceSystems.ts — hook static containment (C/D/E)", () => {
  const code = readFile("useSourceSystems.ts");

  it("uses the orchestrator's re-exported listSourceSystems, never httpClient.ts directly (module boundary)", () => {
    expect(code).toMatch(/from\s+["']@\/lib\/data-hub\/client\/orchestrator["']/);
    expect(code).not.toMatch(/from\s+["'][^"']*data-hub\/client\/httpClient["']/);
  });

  it("D/E: a failed/errored response never throws and always resolves to a distinct 'error' status the caller can render around — never an uncaught rejection that could crash the Select screen", () => {
    expect(code).toMatch(/status:\s*"error"/);
    expect(code).not.toMatch(/throw\b/);
  });

  it("C: a successful response dispatches LOAD_SUCCESS with the real sourceSystems array from the response body, not a hardcoded list", () => {
    expect(code).toMatch(/dispatch\(\{\s*type:\s*"LOAD_SUCCESS",\s*sourceSystems:\s*result\.body\.sourceSystems\s*\}\)/);
    expect(code).toMatch(/case\s+"LOAD_SUCCESS":\s*\n\s*return\s*\{\s*status:\s*"success",\s*sourceSystems:\s*action\.sourceSystems\s*\};/);
  });

  it("never persists to localStorage/sessionStorage/indexedDB (mirrors the existing repo-wide M17 rule)", () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
  });
});

// ---------------------------------------------------------------------------
// AE — containment proof scoped narrowly to the 5B.5A files/call chain, as
// Section 18 requires (existing repository occurrences elsewhere are
// expected and out of scope for this proof).
// ---------------------------------------------------------------------------

describe("Section 18 — containment scoped to the 5B.5A call chain", () => {
  const changedFiles = [
    ["_components", "FileSelector.tsx"],
    ["useSourceSystems.ts"],
  ];

  it("neither new/changed app/data-hub/import file references sourceMappingId, mappingVersionId, or expectedMappingVersionId", () => {
    for (const segments of changedFiles) {
      const code = readFile(...segments);
      expect(code, `${segments.join("/")} must not reference sourceMappingId`).not.toMatch(/sourceMappingId/);
      expect(code, `${segments.join("/")} must not reference mappingVersionId`).not.toMatch(/mappingVersionId/);
      expect(code, `${segments.join("/")} must not reference expectedMappingVersionId`).not.toMatch(/expectedMappingVersionId/);
    }
  });

  // Data Hub 5B.5B — NARROWLY UPDATED (not weakened). orchestrator.ts and
  // httpClient.ts are SHARED files across every Data Hub client slice, not
  // 5B.5A-exclusive ones — Phase 5B.5B is the separately-authorized slice
  // that legitimately adds mapping-selection code (selectMapping(),
  // listSourceMappings, getSourceMapping) to these SAME files. The original
  // whole-file sweep below is therefore no longer the correct assertion of
  // this test's own real intent, which was always "the 5B.5A SourceSystem
  // code introduces no mapping reference" — never "this file may never
  // gain one, ever, from any future authorized slice". This test now
  // excludes exactly the 5B.5B-added blocks (identified by their own
  // unique anchor text, not merely "isn't 5B.5A" by omission) and asserts
  // the REMAINDER — i.e. every line 5B.5A itself actually authored — still
  // carries zero mapping reference, preserving the real, still-true
  // invariant this test protects.
  it("the 5B.5A-authored regions of orchestrator.ts/httpClient.ts (excluding 5B.5B's own separately-authorized mapping-selection additions) introduce no mapping-related field", () => {
    function excludeBlock(src: string, startAnchor: string, endAnchor: string): string {
      const start = src.indexOf(startAnchor);
      const end = src.indexOf(endAnchor, start);
      expect(start, `start anchor not found: ${startAnchor}`).toBeGreaterThan(-1);
      expect(end, `end anchor not found: ${endAnchor}`).toBeGreaterThan(start);
      return src.slice(0, start) + src.slice(end);
    }

    let orchestratorSrc = fs.readFileSync(path.join(ROOT, "lib", "data-hub", "client", "orchestrator.ts"), "utf8");
    // Excludes selectMapping() (Step 5.6) — bounded up to runLoadPreview's
    // own pre-existing method, which 5B.5A never touched.
    orchestratorSrc = excludeBlock(
      orchestratorSrc,
      "// Step 5.6 — Data Hub 5B.5B",
      "private async runLoadPreview(batch: ImportBatchHandle, worksheet: WorksheetSummaryDTOClient): Promise<void> {"
    );
    // Excludes the listSourceMappings/getSourceMapping passthrough exports
    // — bounded up to the pre-existing resolveUploadPathname re-export.
    orchestratorSrc = excludeBlock(orchestratorSrc, "// Data Hub 5B.5B — SourceMapping list/detail reads.", "export { resolveUploadPathname };");

    let httpClientSrc = fs.readFileSync(path.join(ROOT, "lib", "data-hub", "client", "httpClient.ts"), "utf8");
    httpClientSrc = excludeBlock(
      httpClientSrc,
      "// GET /api/data-hub/source-mappings (Data Hub 5B.5B)",
      "// POST /api/data-hub/import-batches/[id]/inspect"
    );
    httpClientSrc = excludeBlock(
      httpClientSrc,
      "// POST /api/data-hub/worksheets/[id]/mapping-selection (Data Hub 5B.4B",
      "// POST /api/data-hub/worksheets/[id]/confirm-illegal-dumping"
    );

    for (const src of [orchestratorSrc, httpClientSrc]) {
      expect(src).not.toMatch(/sourceMappingId/);
      expect(src).not.toMatch(/mappingVersionId/);
      expect(src).not.toMatch(/expectedMappingVersionId/);
      expect(src).not.toMatch(/mappingDocument/);
    }
  });

  it("types.ts's new SourceSystem section introduces no mapping-related field", () => {
    const typesSrc = fs.readFileSync(path.join(ROOT, "lib", "data-hub", "client", "types.ts"), "utf8");
    const sectionIdx = typesSrc.indexOf("SourceSystemDTOClient");
    const sectionEnd = typesSrc.indexOf("ListSourceSystemsResult", sectionIdx);
    const section = typesSrc.slice(sectionIdx, sectionEnd + 40);
    expect(section).not.toMatch(/mapping/i);
  });
});

// ---------------------------------------------------------------------------
// AH — Preview/Confirm/mapping-selection routes remain entirely untouched
// by this diff (protected-file zero-diff is separately proven by the
// coordinator's own git diff --stat check; this proves no NEW reference to
// them exists in the new/changed files).
// ---------------------------------------------------------------------------

describe("no reference to Preview/Confirm/mapping-selection routes from the new SourceSystem selection surface", () => {
  it("FileSelector.tsx and useSourceSystems.ts never reference preview, confirm-illegal-dumping, or mapping-selection endpoints", () => {
    for (const segments of [["_components", "FileSelector.tsx"], ["useSourceSystems.ts"]]) {
      const code = readFile(...segments);
      expect(code).not.toMatch(/mapping-selection/);
      expect(code).not.toMatch(/confirm-illegal-dumping/);
      expect(code).not.toMatch(/\/preview\b/);
    }
  });
});
