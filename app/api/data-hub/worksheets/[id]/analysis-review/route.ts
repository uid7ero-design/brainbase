import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { loadAnalysisReview } from "@/lib/data-hub/analysisExecution/loadAnalysisReview";
import { saveAnalysisReview } from "@/lib/data-hub/analysisExecution/saveAnalysisReview";

const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
function failure(code: string) {
  const status = code === "UPLOAD_NOT_FOUND" || code === "REVIEW_NOT_FOUND" ? 404
    : code === "REVIEW_ACTOR_INVALID" ? 403
    : code === "REVIEW_INPUT_INVALID" || code === "CONTEXT_INPUT_INVALID" ? 400
    : ["REVIEW_SAVE_FAILED", "REVIEW_READ_FAILED", "CONTEXT_READ_FAILED"].includes(code) ? 503
    : ["REVIEW_PROFILE_CHANGED", "PROFILE_NOT_COMPLETE", "PROFILE_LINEAGE_MISMATCH", "PROFILER_VERSION_UNSUPPORTED"].includes(code) ? 409 : 422;
  // Do not expose engine details, exception text or source values.
  return NextResponse.json({ ok: false, code }, { status, headers });
}
async function session() {
  try { return { ok: true as const, session: await requireRole("manager") }; }
  catch (error) {
    const forbidden = error instanceof Error && error.message === "Forbidden";
    return { ok: false as const, response: NextResponse.json({ ok: false, code: forbidden ? "FORBIDDEN" : "UNAUTHORIZED" },
      { status: forbidden ? 403 : 401, headers }) };
  }
}
export async function GET(_request: Request, { params }: Context) {
  const auth = await session(); if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const result = await loadAnalysisReview({ organisationId: auth.session.organisationId, uploadId: id });
    return result.ok ? NextResponse.json(result, { status: 200, headers }) : failure(result.code);
  } catch { return failure("REVIEW_READ_FAILED"); }
}
export async function POST(request: Request, { params }: Context) {
  const auth = await session(); if (!auth.ok) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return failure("REVIEW_INPUT_INVALID"); }
  try {
    const { id } = await params;
    const result = await saveAnalysisReview({ organisationId: auth.session.organisationId, uploadId: id,
      actorId: auth.session.userId }, body);
    return result.ok ? NextResponse.json(result, { status: 201, headers }) : failure(result.code);
  } catch { return failure("REVIEW_SAVE_FAILED"); }
}
