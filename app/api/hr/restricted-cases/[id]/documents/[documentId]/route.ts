import { NextRequest, NextResponse } from 'next/server';
import { forbidden, requireSession, unauthorized } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { logRestrictedHrReadEvent } from '@/lib/hr/auditLog';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { restrictedActorFromSession } from '@/lib/hr/restrictedAccess';
import { requireRestrictedCase } from '@/lib/hr/restrictedRoute';
import {
  downloadRestrictedCaseDocumentBytes,
  getRestrictedCaseDocument,
  softDeleteRestrictedCaseDocument,
} from '@/lib/hr/restrictedCaseDocuments';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function documentNotFound() {
  return NextResponse.json({ error: 'Restricted HR document not found.' }, { status: 404 });
}

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
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id: caseId, documentId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const access = await requireRestrictedCase(entry.session, caseId);
  if (!access.ok) return access.response;
  if (!UUID_RE.test(documentId)) return documentNotFound();

  const document = await getRestrictedCaseDocument(
    entry.session.organisationId,
    caseId,
    documentId,
  );
  if (!document) return documentNotFound();

  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    await logRestrictedHrReadEvent(
      { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      {
        action: 'hr_restricted_case_document.read',
        resourceType: 'hr_restricted_case_document',
        resourceId: document.id,
        afterState: {
          case_id: document.case_id,
          uploaded_by: document.uploaded_by,
          original_filename: document.original_filename,
          content_type: document.content_type,
          byte_size: document.byte_size,
          deleted_at: document.deleted_at,
        },
      },
    );
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/documents/[documentId] GET] read audit failed', err);
    return NextResponse.json({ error: 'Unable to record restricted HR access.' }, { status: 503 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadRestrictedCaseDocumentBytes(document);
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === 'NOT_FOUND') return documentNotFound();
    console.error('[restricted HR documents] download failed', err, { documentId });
    return NextResponse.json({ error: 'The restricted HR document could not be retrieved.' }, { status: 502 });
  }

  const safeFilename = document.original_filename.replace(/["\\\r\n]/g, '');
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': document.content_type,
      'Content-Disposition': `attachment; filename="${safeFilename || 'file'}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id: caseId, documentId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const access = await requireRestrictedCase(entry.session, caseId);
  if (!access.ok) return access.response;
  if (!UUID_RE.test(documentId)) return documentNotFound();

  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const result = await softDeleteRestrictedCaseDocument({
      actor: { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      caseId,
      documentId,
    });
    if (result.outcome === 'not_found') return documentNotFound();
    return NextResponse.json({ deleted: true, document_id: documentId, deleted_at: result.deletedAt });
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/documents/[documentId] DELETE] failed', err);
    return NextResponse.json({ error: 'Could not delete restricted HR document.' }, { status: 500 });
  }
}
