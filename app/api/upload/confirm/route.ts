import { NextRequest, NextResponse } from "next/server";
import { requireRole, unauthorized } from "@/lib/org";
import { confirmImport } from "@/services/upload";

/**
 * POST /api/upload/confirm
 * Body: { upload_id: string; field_mappings?: Record<string, string | null> }
 *
 * Triggers row-level import for the given upload_id.
 * The upload must already exist (created by POST /api/upload) and be PREVIEW_READY.
 */
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireRole("manager"); }
  catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return unauthorized();
  }

  let body: { upload_id?: string; field_mappings?: Record<string, string | null> };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const { upload_id, field_mappings } = body;
  if (!upload_id) return NextResponse.json({ error: "upload_id is required." }, { status: 400 });

  try {
    const result = await confirmImport({
      upload_id,
      organisation_id: session.organisationId,
      field_mappings,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "Upload not found")      return NextResponse.json({ error: msg }, { status: 404 });
    if (msg === "Upload already imported") return NextResponse.json({ error: msg }, { status: 409 });
    console.error("[POST /api/upload/confirm]", err);
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }
}
