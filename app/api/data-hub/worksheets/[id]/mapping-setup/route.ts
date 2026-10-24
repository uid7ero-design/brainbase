import { NextResponse } from "next/server";
import { requireRole } from "@/lib/org";
import { changeMappingSetup, MappingSetupError, readMappingSetup } from "@/lib/data-hub/schemaProfiles/mappingSetup";

const headers = { "Cache-Control": "private, no-store" };
const failure = (code: string, status: number) => NextResponse.json({ ok: false, code }, { status, headers });
async function handle(request: Request, params: Promise<{ id: string }>, write: boolean) {
  let session;
  try { session = await requireRole("manager"); }
  catch (error) { return failure(error instanceof Error && error.message === "Forbidden" ? "FORBIDDEN" : "UNAUTHORIZED", error instanceof Error && error.message === "Forbidden" ? 403 : 401); }
  try {
    if (new URL(request.url).searchParams.size) return failure("MAPPING_REVIEW_INVALID", 400);
    const { id } = await params;
    let body: unknown;
    if (write) {
      // NextURL canonicalizes loopback hosts to localhost. The browser's Host
      // preserves its actual authority; do not treat that normalization as CSRF.
      const origin = new URL(request.url);
      origin.host = request.headers.get("host") ?? origin.host;
      if (request.headers.has("origin") && request.headers.get("origin") !== origin.origin) return failure("FORBIDDEN", 403);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return failure("MAPPING_REVIEW_INVALID", 400);
      // Bound the stream itself; Content-Length can be missing or false.
      if (!request.body) return failure("MAPPING_REVIEW_INVALID", 400);
      const reader = request.body.getReader(); let size = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
        if (size > 32768) { await reader.cancel(); return failure("MAPPING_REVIEW_INVALID", 400); } text += decoder.decode(chunk.value, { stream: true }); }
        body = JSON.parse(text + decoder.decode());
      } catch { return failure("MAPPING_REVIEW_INVALID", 400); } finally { reader.releaseLock(); }
    }
    const scope = { organisationId: session.organisationId, userId: session.userId, uploadId: id };
    const result = write ? await changeMappingSetup(scope, body) : await readMappingSetup(scope);
    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    if (error instanceof MappingSetupError) return failure(error.code, error.code === "UPLOAD_NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "MAPPING_REVIEW_INVALID" ? 400 : 409);
    // SQL/provider details may contain source content. Never return or log them.
    return failure("MAPPING_SETUP_UNAVAILABLE", 503);
  }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, false); }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return handle(request, params, true); }
