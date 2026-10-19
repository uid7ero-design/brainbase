import { NextResponse } from "next/server";
import { requireRole } from "../../org";
import { parseReviewHistoryQuery } from "../analysis/reviewHistory";
import { loadReviewHistory } from "./loadReviewHistory";

const headers = { "Cache-Control": "private, no-store" };
const failure = (code: string, status: number) => NextResponse.json({ ok: false, code }, { status, headers });
export async function reviewHistoryRoute(request: Request, params: Promise<{ id: string }>, kind: "page" | "compare") {
  let session;
  try { session = await requireRole("manager"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? failure("FORBIDDEN", 403) : failure("UNAUTHORIZED", 401); }
  try {
    const query = parseReviewHistoryQuery(new URL(request.url).searchParams, kind);
    if (!query) return failure("REVIEW_HISTORY_INVALID", 400);
    const { id } = await params;
    const result = await loadReviewHistory({ organisationId: session.organisationId, uploadId: id }, query);
    if (result.ok) return NextResponse.json(result, { status: 200, headers });
    const status = result.code === "UPLOAD_NOT_FOUND" || result.code === "REVIEW_NOT_FOUND" ? 404 : result.code === "REVIEW_HISTORY_INVALID" ? 400
      : ["REVIEW_PROFILE_CHANGED", "REVIEW_REVISION_MISMATCH", "PROFILE_NOT_COMPLETE"].includes(result.code) ? 409 : result.code === "REVIEW_FIELD_LIMIT" ? 422 : 503;
    return failure(result.code, status);
  } catch { return failure("REVIEW_HISTORY_UNAVAILABLE", 503); }
}
