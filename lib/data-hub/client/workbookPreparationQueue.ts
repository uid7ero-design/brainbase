import { PREPARATION_STEPS, preparationRequest, readPreparationStatus,
  type PreparationSnapshot, type PreparationStep } from "./preparation";
import { loadWorkbookWorksheets, workbookWorksheetState, WORKSHEET_CHECK_TIMEOUT_MS, type WorkbookWorksheet } from "./workbookPreparation";

export const MAX_PREPARATION_SELECTION = 10;
export const QUEUE_WORKSHEET_TIMEOUT_MS = 65_000;
export const PREPARATION_QUEUE_TIMEOUT_MS = 300_000;
export type PreparationProgress = {
  phase: "checking" | "preparing" | "ready" | "attention";
  step?: PreparationStep;
  snapshot?: PreparationSnapshot;
};

// This is an ephemeral, explicitly confirmed browser queue, never a worker or
// authority. Every existing endpoint still derives scope and lineage itself.
export async function prepareWorkbookSelection(batchId: string, selection: WorkbookWorksheet[], signal: AbortSignal,
  onProgress: (id: string, progress: PreparationProgress) => void): Promise<{ complete: boolean }> {
  if (!selection.length || selection.length > MAX_PREPARATION_SELECTION ||
    selection.some(row => row.excluded) || new Set(selection.map(row => row.id)).size !== selection.length ||
    new Set(selection.map(row => row.index)).size !== selection.length) throw new Error("SELECTION_INVALID");
  const admitted = selection.map(row => ({ ...row })).sort((a, b) => a.index - b.index);
  const queue = new AbortController();
  let timedOut = false;
  const abort = () => queue.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const deadline = setTimeout(() => { timedOut = true; queue.abort(); }, PREPARATION_QUEUE_TIMEOUT_MS);
  try {
    const inventoryDeadline = setTimeout(() => { timedOut = true; queue.abort(); }, WORKSHEET_CHECK_TIMEOUT_MS);
    let inventory: WorkbookWorksheet[];
    try { inventory = await loadWorkbookWorksheets(batchId, queue.signal); }
    finally { clearTimeout(inventoryDeadline); }
    const current = new Map(inventory.map(row => [row.id, row]));
    if (queue.signal.aborted) throw new Error("REQUEST_CANCELLED");
    if (admitted.some(row => !current.has(row.id) || current.get(row.id)!.excluded || current.get(row.id)!.index !== row.index || current.get(row.id)!.name !== row.name)) {
      throw new Error("SELECTION_CHANGED");
    }
    for (const worksheet of admitted) {
      if (queue.signal.aborted) throw new Error("REQUEST_CANCELLED");
      const controller = new AbortController();
      const stop = () => controller.abort();
      queue.signal.addEventListener("abort", stop, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, QUEUE_WORKSHEET_TIMEOUT_MS);
      const report = (progress: PreparationProgress) => {
        if (!controller.signal.aborted) onProgress(worksheet.id, progress);
      };
      try {
        report({ phase: "checking" });
        let snapshot = await readPreparationStatus(worksheet.id, controller.signal);
        for (const step of PREPARATION_STEPS) {
          if (controller.signal.aborted) throw new Error("REQUEST_CANCELLED");
          if (snapshot[step].status === "SUCCEEDED") continue;
          // A running, failed, inconsistent or yielded operation requires an
          // explicit single-worksheet decision. Never retry/continue it here.
          if (workbookWorksheetState(worksheet, { snapshot }) !== "needs" || snapshot[step].status !== "NOT_STARTED") {
            report({ phase: "attention", snapshot }); return { complete: false };
          }
          report({ phase: "preparing", step });
          const result = await preparationRequest(worksheet.id, step, "POST", controller.signal);
          snapshot = await readPreparationStatus(worksheet.id, controller.signal);
          if (controller.signal.aborted) throw new Error("REQUEST_CANCELLED");
          if (result.status !== "SUCCEEDED" || snapshot[step].status !== "SUCCEEDED") {
            report({ phase: "attention", snapshot }); return { complete: false };
          }
        }
        if (controller.signal.aborted) throw new Error("REQUEST_CANCELLED");
        if (workbookWorksheetState(worksheet, { snapshot }) !== "ready") throw new Error("RESPONSE_INVALID");
        report({ phase: "ready", snapshot });
      } finally { clearTimeout(timer); controller.abort(); queue.signal.removeEventListener("abort", stop); }
    }
    return { complete: true };
  } catch (failure) {
    if (timedOut) throw new Error("QUEUE_TIMEOUT");
    throw failure;
  } finally { clearTimeout(deadline); queue.abort(); signal.removeEventListener("abort", abort); }
}
