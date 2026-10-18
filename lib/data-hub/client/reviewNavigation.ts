import { loadWorkbookWorksheets, type WorkbookWorksheet } from "./workbookPreparation";

export function reviewWorkbookHint(value: unknown): string | undefined {
  return typeof value === "string" && !!value.trim() && value.length <= 512 ? value : undefined;
}
export function worksheetReviewHref(uploadId: string, batchId: string) {
  return `/data-hub/analysis/${encodeURIComponent(uploadId)}?workbook=${encodeURIComponent(batchId)}`;
}
export async function loadReviewNavigation(uploadId: string, batchId: string, signal: AbortSignal) {
  if (!reviewWorkbookHint(uploadId) || !reviewWorkbookHint(batchId)) throw new Error("RESPONSE_INVALID");
  const worksheets = await loadWorkbookWorksheets(batchId, signal);
  const eligible = worksheets.filter(row => !row.excluded);
  const position = eligible.findIndex(row => row.id === uploadId);
  if (position < 0) throw new Error("RESPONSE_INVALID");
  return { worksheets: eligible, position };
}
export type ReviewNavigation = { worksheets: WorkbookWorksheet[]; position: number };
