import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.3C.1 — architectural-invariant containment proofs (T23-T35 and
// most of the M-series adversarial mutations). Static source-text
// containment, matching this repo's dominant existing convention — no DOM
// harness exists in this repo (vitest.config.ts: environment 'node', no
// jsdom/@testing-library/react), so these prove SOURCE-LEVEL invariants,
// not actual rendered DOM behavior.

const ROOT = process.cwd();
const IMPORT_DIR = path.join(ROOT, "app", "data-hub", "import");

function walk(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readAll(): { file: string; code: string }[] {
  return walk(IMPORT_DIR, [".ts", ".tsx"]).map((file) => ({
    file: path.relative(ROOT, file),
    code: stripComments(fs.readFileSync(file, "utf8")),
  }));
}

describe("T24/M2/M14: no XLS/XLSX reachability anywhere under app/data-hub/import/**", () => {
  it("no file imports xlsx, SheetJS, or workbookParser, directly or by string reference", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not import xlsx`).not.toMatch(/from\s+["']xlsx["']/);
      expect(code, `${file} must not import workbookParser`).not.toMatch(/workbookParser/);
      expect(code, `${file} must not reference SheetJS`).not.toMatch(/SheetJS/i);
    }
  });

  it("the file input's accept attribute never contains xlsx/xls/spreadsheet MIME types", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "fileValidation.ts"), "utf8");
    const match = code.match(/FILE_INPUT_ACCEPT\s*=\s*["'`]([^"'`]+)["'`]/);
    expect(match).not.toBeNull();
    const accept = match![1].toLowerCase();
    expect(accept).not.toMatch(/xlsx|\bxls\b|spreadsheet/);
  });
});

describe("T23/M4: no browser CSV parsing/authority anywhere under app/data-hub/import/**", () => {
  it("no file calls a CSV-parsing library or hand-rolls a split(',')-shaped parse of file content", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not import csv-parse`).not.toMatch(/from\s+["']csv-parse/);
      expect(code, `${file} must not hand-parse file text via .text().then`).not.toMatch(/\.text\(\)\.then/);
      expect(code, `${file} must not split on commas from file content`).not.toMatch(/\.split\(\s*["'],["']\s*\)/);
    }
  });

  it("FileSelector.tsx only ever inspects file.name/file.type/file.size, never reads file content", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "FileSelector.tsx"), "utf8");
    expect(code).not.toMatch(/\.text\(\)/);
    expect(code).not.toMatch(/\.arrayBuffer\(\)/);
    expect(code).not.toMatch(/FileReader/);
  });
});

describe("T25/M9: no raw Blob token/storage locator rendering/logging", () => {
  it("no file logs uploadToken to the console", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not console.log an upload token`).not.toMatch(/console\.(log|warn|error)\([^)]*uploadToken/);
    }
  });

  it("uploadToken only ever appears as a pass-through parameter/property, never interpolated into JSX text content", () => {
    for (const { file, code } of readAll()) {
      // A JSX text interpolation of uploadToken would look like
      // `{state.uploadToken}` or `{uploadToken}` ANYWHERE between a JSX
      // open-tag's `>` and the next `<` — not necessarily immediately
      // adjacent to the `>` (there may be literal text before it, e.g.
      // "Uploading… {state.uploadToken}"). Distinct from a plain
      // property/parameter reference like `uploadToken,` passed to a
      // function call (which never sits between a bare `>` and `<` pair).
      const tagBodyWithToken = />[^<]*\{[^}]*uploadToken[^}]*\}[^<]*</;
      expect(code, `${file} must never render uploadToken as text`).not.toMatch(tagBodyWithToken);
    }
  });
});

describe("T26/M3: no legacy /api/files/upload or /api/upload/** use", () => {
  it("no file references the legacy upload API paths", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not reference /api/files/upload`).not.toContain("/api/files/upload");
      expect(code, `${file} must not reference /api/upload`).not.toContain("/api/upload");
    }
  });
});

describe("T27: no legacy /data uploader (services/upload.ts, lib/schema-detector.ts, lib/column-mapper.ts) use", () => {
  it("no file imports from the legacy uploader services", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not import services/upload`).not.toMatch(/from\s+["'@][^"']*services\/upload/);
      expect(code, `${file} must not import lib\/schema-detector`).not.toMatch(/schema-detector/);
      expect(code, `${file} must not import lib\/column-mapper`).not.toMatch(/column-mapper/);
    }
  });
});

describe("T31/M10: no direct fetch to /api/data-hub/** from UI components/hook — network stays inside the shipped client boundary", () => {
  it("no file under app/data-hub/import/** calls fetch() against a /api/data-hub path directly", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not fetch /api/data-hub directly`).not.toMatch(/fetch\(\s*[`"'][^`"']*\/api\/data-hub/);
    }
  });

  it("no file imports fetch-adjacent network primitives beyond the orchestrator/session object itself", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not import httpClient.ts directly (only orchestrator.ts's own public surface is used)`).not.toMatch(
        /from\s+["'@][^"']*data-hub\/client\/httpClient/
      );
    }
  });
});

describe("W/V/M9(Blob): UI never imports @vercel/blob/client directly", () => {
  it("no file imports @vercel/blob/client", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not import @vercel/blob/client`).not.toMatch(/@vercel\/blob\/client/);
    }
  });
});

describe("M15: no caller-controlled organisation/tenant authority", () => {
  it("no file under app/data-hub/import/** references organisationId at all — its complete absence is itself the proof, since the shipped client's public API takes no such parameter anywhere", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not reference organisationId`).not.toMatch(/organisationId/);
      expect(code, `${file} must not reference organisation_id`).not.toMatch(/organisation_id/);
    }
  });
});

describe("M13: ImportError never directly interpolates a raw internal code into rendered text", () => {
  it("ImportError.tsx's `code` prop is used only for the data-error-code attribute, never inside the rendered title/message text nodes", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ImportError.tsx"), "utf8");
    expect(code).toContain("data-error-code={code}");
    const titleLine = code.match(/\{title\}/);
    const messageLine = code.match(/\{message\}/);
    expect(titleLine).not.toBeNull();
    expect(messageLine).not.toBeNull();
    // `code` must never itself be interpolated as a JSX expression anywhere
    // in the file EXCEPT the one data-error-code attribute occurrence — a
    // second occurrence anywhere (e.g. `{title} {code}` inside a text node)
    // is exactly the leak this proves against, regardless of what precedes
    // it in the same JSX children list.
    const codeExpressionOccurrences = (code.match(/\{code\}/g) ?? []).length;
    expect(codeExpressionOccurrences).toBe(1);
  });

  it("ProcessingStatus.tsx never renders the raw failureCode/code fields as visible user text — only via ImportError's title/message props (which are curated copy, not raw codes)", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ProcessingStatus.tsx"), "utf8");
    expect(code).not.toMatch(/>\{.*failureCode.*\}</);
    expect(code).not.toMatch(/>\{.*state\.code.*\}</);
  });
});

describe("T29/M12: review table horizontal containment", () => {
  it("ReviewPanel.tsx's table wrapper uses overflowX: 'auto'", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ReviewPanel.tsx"), "utf8");
    expect(code).toMatch(/overflowX:\s*["']auto["']/);
  });

  it("the scrollable wrapper is keyboard-focusable (tabIndex={0}) with an aria-label", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ReviewPanel.tsx"), "utf8");
    const wrapperIdx = code.indexOf("overflowX:");
    const surrounding = code.slice(Math.max(0, wrapperIdx - 300), wrapperIdx + 50);
    expect(surrounding).toMatch(/tabIndex=\{0\}/);
    expect(surrounding).toMatch(/aria-label=/);
  });
});

describe("T32: beforeunload is active only for uploading/finalizing/confirming", () => {
  it("ImportClient.tsx's IN_FLIGHT_NAV_GUARD_PHASES set is exactly {uploading, finalizing, confirming} — no more, no fewer", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "ImportClient.tsx"), "utf8");
    const match = code.match(/IN_FLIGHT_NAV_GUARD_PHASES\s*=\s*new Set\(\[([^\]]+)\]\)/);
    expect(match).not.toBeNull();
    const phases = match![1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
    expect(new Set(phases)).toEqual(new Set(["uploading", "finalizing", "confirming"]));
  });

  it("the beforeunload listener is attached/removed inside a useEffect keyed on state.phase, never a module-level/always-on registration", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "ImportClient.tsx"), "utf8");
    const addIdx = code.indexOf("addEventListener(\"beforeunload\"");
    expect(addIdx).toBeGreaterThan(-1);
    const before = code.slice(Math.max(0, addIdx - 400), addIdx);
    expect(before).toContain("useEffect(() => {");
    const after = code.slice(addIdx, addIdx + 300);
    expect(after).toContain("removeEventListener(\"beforeunload\"");
    expect(after).toMatch(/\[state\.phase\]/);
  });

  it("no top-level (module-scope) beforeunload listener registration exists", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "ImportClient.tsx"), "utf8");
    // A module-level registration would appear outside any function body —
    // approximate proof: it must always appear inside the useEffect block
    // found above, and there is exactly one addEventListener call total.
    const count = (code.match(/addEventListener\("beforeunload"/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("T35: alreadyImported does not require importedRows to render truthful success", () => {
  it("ImportSuccess.tsx only reads state.importedRows inside the isFresh (imported) ternary branch, never unconditionally", () => {
    const code = stripComments(fs.readFileSync(path.join(IMPORT_DIR, "_components", "ImportSuccess.tsx"), "utf8"));
    const ternaryIdx = code.indexOf("isFresh\n            ?");
    expect(ternaryIdx).toBeGreaterThan(-1);
    const ternaryBlock = code.slice(ternaryIdx, ternaryIdx + 200);
    expect(ternaryBlock).toContain("state.importedRows");
    // state.importedRows must appear ONLY inside this one ternary's
    // true-branch (before its `:` else-branch), never elsewhere in the file.
    const totalOccurrences = (code.match(/state\.importedRows/g) ?? []).length;
    expect(totalOccurrences).toBe(1);
  });

  it("the alreadyImported (else) branch text never mentions a row count", () => {
    const code = stripComments(fs.readFileSync(path.join(IMPORT_DIR, "_components", "ImportSuccess.tsx"), "utf8"));
    const elseIdx = code.indexOf('"This worksheet had already been imported');
    expect(elseIdx).toBeGreaterThan(-1);
    expect(code.slice(elseIdx, elseIdx + 100)).not.toMatch(/\$\{state\.importedRows\}/);
  });
});

describe("T7/M5: real upload progress source is used, never fake/timer-driven progress", () => {
  it("UploadProgress.tsx never uses setInterval/setTimeout to synthesize a progress percentage", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "UploadProgress.tsx"), "utf8");
    expect(code).not.toMatch(/setInterval/);
    expect(code).not.toMatch(/setTimeout/);
  });

  it("progress is read from the real onUploadProgress-sourced state.progress/callback value, not a locally-incremented counter", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "UploadProgress.tsx"), "utf8");
    expect(code).toContain("state.progress?.percentage");
    expect(code).toContain("p.percentage");
    // The only mutation of progressPct comes from the real callback, never
    // from an incrementing loop.
    expect(code).not.toMatch(/progressPct\s*\+\s*1|progressPct\s*\+=/);
  });
});

describe("T8: cancellation maps to abort()", () => {
  it("UploadProgress.tsx's Cancel button is wired to session.abort(), only reachable during the real 'uploading' phase", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "UploadProgress.tsx"), "utf8");
    const uploadingBlockIdx = code.indexOf('state.phase === "uploading"');
    expect(uploadingBlockIdx).toBeGreaterThan(-1);
    const uploadingBlockEnd = code.indexOf("// uploadUncertain", uploadingBlockIdx);
    const uploadingBlock = code.slice(uploadingBlockIdx, uploadingBlockEnd);
    expect(uploadingBlock).toContain("session.abort()");
    expect(uploadingBlock).toContain("Cancel");
  });
});

describe("T17: fresh imported success renders the real importedRows count", () => {
  it("ImportSuccess.tsx's imported branch interpolates state.importedRows, not a fabricated/hardcoded number", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ImportSuccess.tsx"), "utf8");
    expect(code).toMatch(/\$\{state\.importedRows\}\s*row\(s\)\s*were imported/);
  });
});

describe("T28: accessibility invariants statically provable under this repo's node-only test harness", () => {
  it("the file input is a real, native <input type=\"file\"> — never hidden via display:none/visibility:hidden/aria-hidden", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "FileSelector.tsx"), "utf8");
    expect(code).toMatch(/<input[\s\S]*?type="file"/);
    expect(code).not.toMatch(/display:\s*["']none["']/);
    expect(code).not.toMatch(/aria-hidden/);
  });

  it("the file input has an associated <label htmlFor=...> (visible label, not placeholder-only)", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "FileSelector.tsx"), "utf8");
    expect(code).toMatch(/<label\s+htmlFor="data-hub-import-file-input"/);
    expect(code).toMatch(/id="data-hub-import-file-input"/);
  });

  it("the upload progress element carries role=progressbar with real aria-valuenow/min/max", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "UploadProgress.tsx"), "utf8");
    expect(code).toContain('role="progressbar"');
    expect(code).toContain("aria-valuenow={pct");
    expect(code).toContain("aria-valuemin={0}");
    expect(code).toContain("aria-valuemax={100}");
  });

  it("ImportError carries role=alert and aria-live=assertive", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ImportError.tsx"), "utf8");
    expect(code).toContain('role="alert"');
    expect(code).toContain('aria-live="assertive"');
  });

  it("ImportSuccess carries role=status and aria-live=polite", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ImportSuccess.tsx"), "utf8");
    expect(code).toContain('role="status"');
    expect(code).toContain('aria-live="polite"');
  });

  it("ReviewPanel's preview table uses semantic <table>/<th scope=\"col\">, not a div-grid", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ReviewPanel.tsx"), "utf8");
    expect(code).toContain("<table");
    expect(code).toMatch(/<th[\s\S]*?scope="col"/);
  });

  it("ImportClient.tsx moves focus to the screen heading on every screen-group transition (aria-live wrapper + a ref-focused element keyed on screenGroup)", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "ImportClient.tsx"), "utf8");
    expect(code).toContain("headingRef.current?.focus()");
    expect(code).toMatch(/\[screenGroup\]/);
    expect(code).toContain('aria-live="polite"');
  });

  it("disabled/busy controls carry aria-busy natively (ConfirmAction, UploadProgress's implicit busy states)", () => {
    const confirmCode = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ConfirmAction.tsx"), "utf8");
    expect(confirmCode).toContain("aria-busy={busy}");
  });
});

describe("T34: preview-failure acknowledgement resets on retry/state change", () => {
  it("ReviewPanel.tsx resets `acknowledged` whenever state.phase changes, via React's render-time state-adjustment pattern (not an effect, per this repo's ESLint config)", () => {
    const code = fs.readFileSync(path.join(IMPORT_DIR, "_components", "ReviewPanel.tsx"), "utf8");
    const idx = code.indexOf("prevPhase");
    expect(idx).toBeGreaterThan(-1);
    const block = code.slice(idx, idx + 300);
    expect(block).toMatch(/if\s*\(\s*state\.phase\s*!==\s*prevPhase\s*\)/);
    expect(block).toContain("setAcknowledged(false)");
  });
});

describe("M17: no localStorage/sessionStorage/IndexedDB persistence anywhere (5A.3D boundary)", () => {
  it("no file under app/data-hub/import/** references localStorage, sessionStorage, or indexedDB", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not use localStorage`).not.toMatch(/localStorage/);
      expect(code, `${file} must not use sessionStorage`).not.toMatch(/sessionStorage/);
      expect(code, `${file} must not use indexedDB`).not.toMatch(/indexedDB/i);
    }
  });
});

describe("no dependency/schema/backend containment violations", () => {
  it("no file under app/data-hub/import/** imports Prisma, raw SQL, or app/api/data-hub server route internals", () => {
    for (const { file, code } of readAll()) {
      expect(code, `${file} must not import Prisma`).not.toMatch(/from\s+["'][^"']*\/prisma["']/);
      expect(code, `${file} must not import a Data Hub API route file directly`).not.toMatch(/app\/api\/data-hub/);
      expect(code, `${file} must not import lib\/data-hub\/importBatch server services`).not.toMatch(
        /data-hub\/importBatch\/(previewWorksheet|confirmWorksheet|inspectCsvWorksheet|finalize|initiate)/
      );
    }
  });
});
