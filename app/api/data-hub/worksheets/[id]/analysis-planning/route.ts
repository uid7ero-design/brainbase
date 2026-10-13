import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { loadUploadPlanningCatalog, loadUploadPlanningPage, planUploadSelection } from "@/lib/data-hub/analysisExecution/uploadPlanning";
import type { PlanningExchangeFailure } from "@/lib/data-hub/analysis/planningExchange";
import { parsePlanningPageQuery } from "@/lib/data-hub/analysis/planningCatalogPage";

const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
function failure(result: PlanningExchangeFailure) {
  const status = ["UPLOAD_NOT_FOUND", "REVIEW_NOT_FOUND"].includes(result.code) ? 404
    : ["PROFILE_SELECTION_INVALID", "PLANNING_PAGE_INVALID", "CONTEXT_INPUT_INVALID"].includes(result.code) ? 400
    : ["REVIEW_READ_FAILED", "CONTEXT_READ_FAILED"].includes(result.code) ? 503
    : ["REVIEW_PROFILE_CHANGED", "REVIEW_REVISION_MISMATCH", "PROFILE_NOT_COMPLETE", "PROFILE_LINEAGE_MISMATCH",
      "DATASET_CONTEXT_MISMATCH", "PROFILER_VERSION_UNSUPPORTED"].includes(result.code) ? 409 : 422;
  return NextResponse.json(result, { status, headers });
}
async function session() {
  try { return { ok: true as const, session: await requireRole("manager") }; }
  catch (error) {
    const forbidden = error instanceof Error && error.message === "Forbidden";
    return { ok: false as const, response: NextResponse.json({ ok: false, code: forbidden ? "FORBIDDEN" : "UNAUTHORIZED" },
      { status: forbidden ? 403 : 401, headers }) };
  }
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const entry = await reader.read(); if (entry.done) break;
      size += entry.value.byteLength;
      if (size > 65536) { await reader.cancel(); return null; }
      chunks.push(entry.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; } finally { reader.releaseLock(); }
}
export async function GET(request: Request, { params }: Context) {
  const auth = await session(); if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    if (query.has("pageVersion")) {
      const parsed = parsePlanningPageQuery(query); if (!parsed.ok) return failure(parsed);
      const result = await loadUploadPlanningPage({ organisationId: auth.session.organisationId, uploadId: id }, parsed.request);
      return result.ok ? NextResponse.json(result, { headers }) : failure(result);
    }
    const result = await loadUploadPlanningCatalog({ organisationId: auth.session.organisationId, uploadId: id });
    return result.ok ? NextResponse.json(result, { headers }) : failure(result);
  } catch { return failure({ ok: false, code: "REVIEW_READ_FAILED" }); }
}
// Read-only metadata planning. No append/save, count evaluator or client scope.
export async function POST(request: Request, { params }: Context) {
  const auth = await session(); if (!auth.ok) return auth.response;
  try {
    const input = await body(request);
    if (input === null) return failure({ ok: false, code: "PROFILE_SELECTION_INVALID" });
    const { id } = await params;
    const result = await planUploadSelection({ organisationId: auth.session.organisationId, uploadId: id }, input);
    return result.ok ? NextResponse.json(result, { headers }) : failure(result);
  } catch { return failure({ ok: false, code: "REVIEW_READ_FAILED" }); }
}
