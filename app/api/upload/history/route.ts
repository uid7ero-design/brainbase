import { NextRequest, NextResponse } from "next/server";
import { requireRole, unauthorized } from "@/lib/org";
import { getUploadHistory } from "@/services/upload";

/**
 * GET /api/upload/history?limit=50
 * Returns upload history for the current organisation, newest first.
 */
export async function GET(req: NextRequest) {
  let session;
  try { session = await requireRole("manager"); }
  catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return unauthorized();
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 200);

  try {
    const uploads = await getUploadHistory(session.organisationId, limit);
    return NextResponse.json({ ok: true, uploads });
  } catch (err) {
    console.error("[GET /api/upload/history]", err);
    return NextResponse.json({ error: "Failed to load upload history." }, { status: 500 });
  }
}
