import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Data Hub 6.2D2 — the trusted preview format dispatcher. Only a persisted
// xlsx parent batch reaches previewXlsxWorksheet; everything else is handed,
// unchanged, to the CSV previewWorksheet service so its codes and gate
// precedence are exactly what they were before 6.2D2.

const uploadFindFirst = vi.fn();
const importBatchFindUnique = vi.fn();
const csvPreview = vi.fn();
const xlsxPreview = vi.fn();
const moduleState = vi.hoisted(() => ({ xlsxPreviewLoaded: false }));

vi.mock("@/lib/prisma", () => ({ prisma: {
  upload: { findFirst: (...args: unknown[]) => uploadFindFirst(...args) },
  importBatch: { findUnique: (...args: unknown[]) => importBatchFindUnique(...args) },
} }));
vi.mock("@/lib/data-hub/importBatch/previewWorksheet", () => ({ previewWorksheet: (...args: unknown[]) => csvPreview(...args) }));
vi.mock("@/lib/data-hub/importBatch/previewXlsxWorksheet", () => {
  moduleState.xlsxPreviewLoaded = true;
  return { previewXlsxWorksheet: (...args: unknown[]) => xlsxPreview(...args) };
});

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CSV_SENTINEL = { ok: false, code: "WORKSHEET_NOT_ELIGIBLE", message: "csv service decided" };

async function dispatch(worksheetId = "w-1") {
  const { previewDataHubWorksheet } = await import("@/lib/data-hub/importBatch/previewDataHubWorksheet");
  return previewDataHubWorksheet({ organisationId: "org-1", worksheetId });
}

beforeEach(() => {
  uploadFindFirst.mockReset();
  importBatchFindUnique.mockReset();
  csvPreview.mockReset();
  xlsxPreview.mockReset();
  csvPreview.mockResolvedValue(CSV_SENTINEL);
  uploadFindFirst.mockResolvedValue({ import_batch_id: "batch-1" });
});

describe("previewDataHubWorksheet dispatcher", () => {
  it("27/28. CSV is delegated verbatim to previewWorksheet and never loads the XLSX module", async () => {
    importBatchFindUnique.mockResolvedValue({ content_type: "csv" });
    expect(await dispatch("looks-like.xlsx")).toBe(CSV_SENTINEL);
    expect(csvPreview).toHaveBeenCalledWith({ organisationId: "org-1", worksheetId: "looks-like.xlsx" });
    expect(uploadFindFirst.mock.calls[0][0]).toEqual({
      where: { id: "looks-like.xlsx", organisation_id: "org-1", lineage_kind: "DATA_HUB" },
      select: { import_batch_id: true },
    });
    expect(importBatchFindUnique.mock.calls[0][0]).toEqual({
      where: { id_organisation_id: { id: "batch-1", organisation_id: "org-1" } },
      select: { content_type: true },
    });
    expect(xlsxPreview).not.toHaveBeenCalled();
    expect(moduleState.xlsxPreviewLoaded).toBe(false);
  });

  it("27. CSV gate precedence is untouched: a non-READY/tombstoned CSV batch is still decided by previewWorksheet", async () => {
    importBatchFindUnique.mockResolvedValue({ content_type: "csv" });
    await dispatch();
    expect(csvPreview).toHaveBeenCalledTimes(1);
    const src = stripComments(read("lib/data-hub/importBatch/previewDataHubWorksheet.ts"));
    expect(src).not.toMatch(/status|deleted_at|BATCH_NOT_READY|WORKSHEET_NOT_ELIGIBLE/);
  });

  it("11. xls / unknown content types go to the CSV service (its own UNSUPPORTED_FORMAT gate), never to XLSX", async () => {
    for (const contentType of ["xls", "pdf", "XLSX", "", null]) {
      csvPreview.mockClear();
      importBatchFindUnique.mockResolvedValue({ content_type: contentType });
      await dispatch();
      expect(csvPreview).toHaveBeenCalledTimes(1);
    }
    expect(xlsxPreview).not.toHaveBeenCalled();
  });

  it("1/2. wrong tenant / legacy lineage / missing batch go to the CSV service's WORKSHEET_NOT_FOUND path", async () => {
    uploadFindFirst.mockResolvedValue(null);
    await dispatch("foreign");
    expect(importBatchFindUnique).not.toHaveBeenCalled();
    uploadFindFirst.mockResolvedValue({ import_batch_id: null });
    await dispatch();
    expect(importBatchFindUnique).not.toHaveBeenCalled();
    uploadFindFirst.mockResolvedValue({ import_batch_id: "batch-1" });
    importBatchFindUnique.mockResolvedValue(null);
    await dispatch();
    expect(csvPreview).toHaveBeenCalledTimes(3);
    expect(xlsxPreview).not.toHaveBeenCalled();
  });

  it("xlsx is dispatched solely from persisted content_type, with only the trusted inputs", async () => {
    importBatchFindUnique.mockResolvedValue({ content_type: "xlsx" });
    const preview = { ok: true, preview: { worksheetId: "w-1" } };
    xlsxPreview.mockResolvedValue(preview);
    expect(await dispatch()).toBe(preview);
    expect(xlsxPreview).toHaveBeenCalledWith({ organisationId: "org-1", worksheetId: "w-1" });
    expect(csvPreview).not.toHaveBeenCalled();
  });

  it("28. the dispatcher has no static runtime import of the XLSX service (type-only + lazy import)", () => {
    const src = stripComments(read("lib/data-hub/importBatch/previewDataHubWorksheet.ts"));
    expect(src).not.toMatch(/^import \{[^}]*\} from "\.\/previewXlsxWorksheet"/m);
    expect(src).toMatch(/^import type \{[^}]*\} from "\.\/previewXlsxWorksheet"/m);
    expect(src).toMatch(/await import\("\.\/previewXlsxWorksheet"\)/);
    expect(src).not.toMatch(/from "xlsx"|workbookParser/);
    expect(src.match(/prisma\.\w+\.\w+\(/g)).toEqual(["prisma.upload.findFirst(", "prisma.importBatch.findUnique("]);
    expect(src).not.toMatch(/\$transaction|console\./);
  });

  it("previewXlsxWorksheet has exactly one runtime importer (this dispatcher); the route imports only the dispatcher", () => {
    const hits = execFileSync("git", ["grep", "--untracked", "-l", "-E", "(from|import\\()\\s*\"[^\"]*previewXlsxWorksheet\"", "--", "app", "lib"], { cwd: ROOT, encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
    expect(hits).toEqual(["lib/data-hub/importBatch/previewDataHubWorksheet.ts"]);
    const route = stripComments(read("app/api/data-hub/worksheets/[id]/preview/route.ts"));
    expect(route).toMatch(/from "@\/lib\/data-hub\/importBatch\/previewDataHubWorksheet"/);
    expect(route).not.toMatch(/importBatch\/previewWorksheet"|previewXlsxWorksheet/);
  });
});
