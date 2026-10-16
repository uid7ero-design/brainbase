import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { getWorksheetProfileStatus, profileWorksheetForReview } from "@/lib/data-hub/preparation/worksheetProfile";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
async function authorize() {
  try { return { ok: true as const, session: await requireRole("manager") }; }
  catch (error) {
    const forbidden = error instanceof Error && error.message === "Forbidden";
    return { ok: false as const, response: NextResponse.json({ ok: false, code: forbidden ? "FORBIDDEN" : "UNAUTHORIZED" },
      { status: forbidden ? 403 : 401, headers }) };
  }
}
function failure(code: string) {
  const status = code === "UPLOAD_NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400
    : ["PERSISTENCE_FAILURE", "CONTEXT_READ_FAILED"].includes(code) ? 503
    : ["PROFILE_INPUT_INVALID", "INTERACTIVE_PROFILE_LIMIT"].includes(code) ? 422 : 409;
  return NextResponse.json({ ok: false, code }, { status, headers });
}
async function hasInput(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return false;
  try {
    for (;;) {
      const entry = await reader.read();
      if (entry.done) return false;
      if (entry.value.byteLength) { await reader.cancel(); return true; }
    }
  } finally { reader.releaseLock(); }
}
export async function GET(_request: Request, { params }: Context) {
  const auth = await authorize(); if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const result = await getWorksheetProfileStatus({ organisationId: auth.session.organisationId, uploadId: id });
    return result.ok ? NextResponse.json(result, { headers }) : failure(result.code);
  } catch { return failure("PERSISTENCE_FAILURE"); }
}
export async function POST(request: Request, { params }: Context) {
  const auth = await authorize(); if (!auth.ok) return auth.response;
  // No client-supplied scope, run pointers, normalized evidence or options.
  try {
    if (await hasInput(request)) return failure("INVALID_REQUEST");
    const { id } = await params;
    const result = await profileWorksheetForReview({ organisationId: auth.session.organisationId, uploadId: id, actorId: auth.session.userId });
    return result.ok ? NextResponse.json(result, { status: result.status === "RUNNING" ? 202 : 200, headers }) : failure(result.code);
  } catch { return failure("PERSISTENCE_FAILURE"); }
}
