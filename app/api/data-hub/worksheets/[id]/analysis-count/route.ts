import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { analyzeReviewedUploadCount } from "@/lib/data-hub/analysisExecution/analyzeReviewedUploadCount";

const headers = { "Cache-Control": "private, no-store" };
function failure(code: string) {
  const status = ["UPLOAD_NOT_FOUND", "REVIEW_NOT_FOUND"].includes(code) ? 404
    : ["INVALID_REQUEST", "CONTEXT_INPUT_INVALID"].includes(code) ? 400
    : ["ANALYSIS_EVALUATION_FAILED", "CONTEXT_READ_FAILED", "REVIEW_READ_FAILED"].includes(code) ? 503
    : ["PROFILE_NOT_COMPLETE", "PROFILE_LINEAGE_MISMATCH", "DATASET_CONTEXT_MISMATCH", "PROFILER_VERSION_UNSUPPORTED"].includes(code) ? 409 : 422;
  return NextResponse.json({ ok: false, code }, { status, headers });
}
// Read-only evaluation via POST: the body is a closed analysis request, never
// caller-supplied profile evidence, schema or quality/continuation state.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole("manager"); }
  catch (error) {
    const forbidden = error instanceof Error && error.message === "Forbidden";
    return NextResponse.json({ ok: false, code: forbidden ? "FORBIDDEN" : "UNAUTHORIZED" },
      { status: forbidden ? 403 : 401, headers });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return failure("INVALID_REQUEST"); }
  try {
    const { id } = await params;
    const result = await analyzeReviewedUploadCount({ organisationId: session.organisationId, uploadId: id }, body);
    return result.ok ? NextResponse.json(result, { status: 200, headers }) : failure(result.code);
  } catch { return failure("ANALYSIS_EVALUATION_FAILED"); }
}
