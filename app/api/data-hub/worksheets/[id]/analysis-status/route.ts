import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { loadReviewStatus } from "@/lib/data-hub/analysisExecution/loadReviewStatus";

const headers = { "Cache-Control": "private, no-store" };
const failure = (code: string, status: number) => NextResponse.json({ ok: false, code }, { status, headers });
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireRole("manager"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? failure("FORBIDDEN", 403) : failure("UNAUTHORIZED", 401); }
  try {
    if (new URL(request.url).searchParams.size) return failure("REVIEW_STATUS_INVALID", 400);
    const { id } = await params;
    const result = await loadReviewStatus({ organisationId: session.organisationId, uploadId: id });
    return result.ok ? NextResponse.json(result, { status: 200, headers })
      : failure(result.code, result.code === "UPLOAD_NOT_FOUND" ? 404 : result.code === "REVIEW_STATUS_INVALID" ? 400 : 503);
  } catch { return failure("REVIEW_STATUS_UNAVAILABLE", 503); }
}
