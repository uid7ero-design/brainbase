import { PREPARATION_STEPS, readPreparationStatus, type PreparationSnapshot } from "./preparation";
import { preparationJson } from "./preparationTransport";

export const WORKSHEET_CHECK_TIMEOUT_MS = 15_000;
export const WORKBOOK_CHECK_TIMEOUT_MS = 120_000;
export const WORKBOOK_CHECK_CONCURRENCY = 2;
export type WorkbookWorksheet = { id: string; name: string; index: number; excluded: boolean };
export type WorksheetCheck = { snapshot: PreparationSnapshot } | { failed: true };
export type WorkbookState = "unchecked" | "excluded" | "ready" | "running" | "attention" | "needs";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// The existing inventory DTO is additive. Project only these checked metadata
// fields; never carry diagnostics, storage details or values into the overview.
export function decodeWorkbookWorksheets(body: unknown, batchId: string): WorkbookWorksheet[] {
  if (!record(body) || !Array.isArray(body.worksheets) || body.worksheets.length > 50) throw new Error("RESPONSE_INVALID");
  const ids = new Set<string>(), indices = new Set<number>();
  const worksheets = body.worksheets.map(row => {
    if (!record(row) || typeof row.id !== "string" || !row.id.trim() || row.id.length > 512 || row.importBatchId !== batchId ||
      typeof row.worksheetName !== "string" || row.worksheetName.length > 4096 || typeof row.worksheetIndex !== "number" ||
      !Number.isSafeInteger(row.worksheetIndex) || row.worksheetIndex < 0 || row.worksheetIndex >= 50 ||
      !["visible", "hidden", "veryHidden"].includes(row.worksheetVisibility as string) || typeof row.worksheetIsEmpty !== "boolean" ||
      !["AWAITING_CONFIRMATION", "INELIGIBLE", "SKIPPED", "IMPORTED"].includes(row.canonicalStatus as string) ||
      ids.has(row.id) || indices.has(row.worksheetIndex)) throw new Error("RESPONSE_INVALID");
    ids.add(row.id); indices.add(row.worksheetIndex);
    return { id: row.id, name: row.worksheetName, index: row.worksheetIndex,
      excluded: row.worksheetVisibility !== "visible" || row.worksheetIsEmpty || ["INELIGIBLE", "SKIPPED"].includes(row.canonicalStatus as string) };
  });
  return worksheets.sort((a, b) => a.index - b.index);
}

export async function loadWorkbookWorksheets(batchId: string, signal: AbortSignal) {
  const { response, body } = await preparationJson(`/api/data-hub/import-batches/${encodeURIComponent(batchId)}/worksheets`, "GET", signal);
  if (response.status !== 200) throw new Error("REQUEST_FAILED");
  return decodeWorkbookWorksheets(body, batchId);
}

export function workbookWorksheetState(worksheet: WorkbookWorksheet, check?: WorksheetCheck): WorkbookState {
  if (worksheet.excluded) return "excluded";
  if (!check) return "unchecked";
  if ("failed" in check) return "attention";
  const states = PREPARATION_STEPS.map(step => check.snapshot[step].status);
  if (states.every(status => status === "SUCCEEDED")) return "ready";
  // Separate GETs are observations, not an atomic cross-step snapshot. Reject
  // impossible ordering rather than offering a ready claim from mixed reads.
  if ((states[2] === "SUCCEEDED" && states[1] !== "SUCCEEDED") || (states[1] === "SUCCEEDED" && states[0] !== "SUCCEEDED")) return "attention";
  if (states.some(status => ["FAILED", "ABANDONED"].includes(status))) return "attention";
  return states.includes("RUNNING") ? "running" : "needs";
}

// At most two worksheet checks (six GETs) are active. No automatic execution,
// retries, polling or downstream calls. A scope denial invalidates the scan.
export async function checkWorkbookWorksheets(worksheets: WorkbookWorksheet[], signal: AbortSignal,
  onCheck: (id: string, result: WorksheetCheck) => void) {
  const queue = worksheets.filter(row => !row.excluded);
  const scan = new AbortController();
  const stop = () => scan.abort();
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  let position = 0;
  async function worker() {
    while (position < queue.length && !scan.signal.aborted) {
      const worksheet = queue[position++];
      const controller = new AbortController();
      const abort = () => controller.abort();
      scan.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, WORKSHEET_CHECK_TIMEOUT_MS);
      try {
        const snapshot = await readPreparationStatus(worksheet.id, controller.signal);
        if (!scan.signal.aborted) onCheck(worksheet.id, { snapshot });
      } catch (error) {
        const code = error instanceof Error ? error.message : "REQUEST_FAILED";
        if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) { scan.abort(); throw new Error(code); }
        if (!scan.signal.aborted) onCheck(worksheet.id, { failed: true });
      } finally { clearTimeout(timer); controller.abort(); scan.signal.removeEventListener("abort", abort); }
    }
  }
  try {
    await Promise.all(Array.from({ length: WORKBOOK_CHECK_CONCURRENCY }, worker));
    if (signal.aborted) throw new Error("REQUEST_CANCELLED");
  } finally { scan.abort(); signal.removeEventListener("abort", stop); }
}
