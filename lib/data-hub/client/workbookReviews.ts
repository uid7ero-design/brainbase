import { decodeReviewStatus, type ReviewStatus } from "../analysis/reviewStatus";
import { preparationJson } from "./preparationTransport";
import { WORKBOOK_CHECK_CONCURRENCY, WORKBOOK_CHECK_TIMEOUT_MS, WORKSHEET_CHECK_TIMEOUT_MS, type WorkbookWorksheet } from "./workbookPreparation";

export type ReviewCheck = { status: ReviewStatus } | { failed: true };
export async function checkWorkbookReviews(worksheets: WorkbookWorksheet[], signal: AbortSignal, onCheck: (id: string, check: ReviewCheck) => void) {
  const queue = worksheets.filter(row => !row.excluded).map(row => ({ ...row }));
  if (worksheets.length > 50 || new Set(worksheets.map(row => row.id)).size !== worksheets.length) throw new Error("RESPONSE_INVALID");
  const scan = new AbortController();
  const stop = () => scan.abort();
  signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
  let expired = false, position = 0;
  const deadline = setTimeout(() => { expired = true; scan.abort(); }, WORKBOOK_CHECK_TIMEOUT_MS);
  async function worker() {
    while (position < queue.length && !scan.signal.aborted) {
      const row = queue[position++], controller = new AbortController();
      const abort = () => controller.abort(); scan.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, WORKSHEET_CHECK_TIMEOUT_MS);
      try {
        const { response, body } = await preparationJson(`/api/data-hub/worksheets/${encodeURIComponent(row.id)}/analysis-status`, "GET", controller.signal);
        if (response.status !== 200 || !body || typeof body !== "object" || Array.isArray(body) ||
          Reflect.ownKeys(body).length !== 2 || !Object.hasOwn(body, "ok") || !Object.hasOwn(body, "status") || (body as { ok: unknown }).ok !== true) throw new Error("RESPONSE_INVALID");
        const status = decodeReviewStatus((body as { status: unknown }).status, row.id);
        if (!scan.signal.aborted) onCheck(row.id, { status });
      } catch (failure) {
        const code = failure instanceof Error ? failure.message : "REQUEST_FAILED";
        if (["UNAUTHORIZED", "FORBIDDEN", "UPLOAD_NOT_FOUND"].includes(code)) { scan.abort(); throw new Error(code); }
        if (!scan.signal.aborted) onCheck(row.id, { failed: true });
      } finally { clearTimeout(timer); controller.abort(); scan.signal.removeEventListener("abort", abort); }
    }
  }
  try {
    await Promise.all(Array.from({ length: WORKBOOK_CHECK_CONCURRENCY }, worker));
    if (expired || signal.aborted) throw new Error(expired ? "REQUEST_TIMED_OUT" : "REQUEST_CANCELLED");
  } finally { clearTimeout(deadline); scan.abort(); signal.removeEventListener("abort", stop); }
}
