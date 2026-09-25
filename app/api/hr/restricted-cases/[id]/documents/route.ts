import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireSession, unauthorized } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { logRestrictedHrReadEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { restrictedActorFromSession } from '@/lib/hr/restrictedAccess';
import { requireRestrictedCase } from '@/lib/hr/restrictedRoute';
import {
  listRestrictedCaseDocuments,
  MAX_RESTRICTED_DOCUMENT_BYTES,
  toPublicRestrictedCaseDocument,
  uploadRestrictedCaseDocument,
} from '@/lib/hr/restrictedCaseDocuments';

async function entrySession() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false as const, response: unauthorized() };
  }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 }),
      };
    }
    return { ok: false as const, response: forbidden() };
  }
  return { ok: true as const, session };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const access = await requireRestrictedCase(entry.session, caseId);
  if (!access.ok) return access.response;

  const rows = await listRestrictedCaseDocuments(entry.session.organisationId, caseId);
  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    await Promise.all(rows.map(row => logRestrictedHrReadEvent(
      { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      {
        action: 'hr_restricted_case_document.read',
        resourceType: 'hr_restricted_case_document',
        resourceId: row.id,
        afterState: {
          case_id: row.case_id,
          uploaded_by: row.uploaded_by,
          original_filename: row.original_filename,
          content_type: row.content_type,
          byte_size: row.byte_size,
          deleted_at: row.deleted_at,
        },
      },
    )));
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/documents GET] read audit failed', err);
    return NextResponse.json({ error: 'Unable to record restricted HR access.' }, { status: 503 });
  }

  return NextResponse.json({ documents: rows.map(toPublicRestrictedCaseDocument) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const access = await requireRestrictedCase(entry.session, caseId);
  if (!access.ok) return access.response;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
  }
  if (file.size > MAX_RESTRICTED_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${MAX_RESTRICTED_DOCUMENT_BYTES / (1024 * 1024)}MB limit.` },
      { status: 400 },
    );
  }

  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const result = await uploadRestrictedCaseDocument({
      actor: { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      caseId,
      originalFilename: file.name || 'file',
      contentType: file.type || 'application/octet-stream',
      bytes,
    });
    if (result.outcome === 'case_not_found') {
      return NextResponse.json({ error: 'Restricted HR case not found.' }, { status: 404 });
    }
    if (result.outcome === 'invalid') {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (result.outcome === 'storage_error') {
      return NextResponse.json({ error: 'Could not store restricted HR document.' }, { status: 502 });
    }
    return NextResponse.json({ document: result.document }, { status: 201 });
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/documents POST] upload failed', err);
    return NextResponse.json({ error: 'Could not upload restricted HR document.' }, { status: 500 });
  }
}
