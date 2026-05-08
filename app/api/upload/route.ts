import { NextRequest, NextResponse } from "next/server";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { requireRole, unauthorized } from "@/lib/org";
import { initiateUpload } from "@/services/upload";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * POST /api/upload
 * Accepts multipart/form-data with a `file` field (CSV or XLSX).
 *
 * Returns detection result + upload_id for the confirm step.
 * Does NOT import rows — call POST /api/upload/confirm to commit.
 */
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireRole("manager"); }
  catch (e) {
    const msg = (e as Error).message;
    if (msg === "Forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return unauthorized();
  }

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 }); }

  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds 20 MB limit." }, { status: 413 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["xlsx", "xls", "csv"].includes(ext))
    return NextResponse.json({ error: "Upload a .xlsx, .xls, or .csv file." }, { status: 400 });

  const bytes    = await file.arrayBuffer();
  const buffer   = Buffer.from(bytes);
  const mimetype = file.type || (ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  // Write to /tmp for the confirm step to re-read
  const tmpPath  = join(tmpdir(), `bb_upload_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  writeFileSync(tmpPath, buffer);

  try {
    const result = await initiateUpload({
      organisation_id: session.organisationId,
      user_id:         session.userId,
      filename:        file.name,
      mimetype,
      buffer,
      stored_path:     tmpPath,
    });

    return NextResponse.json({
      ok:        true,
      upload_id: result.upload_id,
      detection: result.detection,
    });
  } catch (err) {
    console.error("[POST /api/upload]", err);
    return NextResponse.json({ error: "Failed to process file." }, { status: 500 });
  }
}

/**
 * GET /api/upload  (alias — redirects to history for legacy compatibility)
 */
export async function GET() {
  return NextResponse.redirect(new URL("/api/upload/history", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
}
