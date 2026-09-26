import { NextRequest, NextResponse } from 'next/server';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';
import { logEmployeeDocumentReadEvent } from '@/lib/hr/auditLog';
import { requireEmployeeDocumentContext } from '@/lib/hr/employeeDocumentHttp';
import {
  employeeDocumentNotFoundResponse,
  requireEmployeeDocumentVersion,
} from '@/lib/hr/employeeDocumentRoute';
import { downloadEmployeeDocumentVersionBytes } from '@/lib/hr/employeeDocumentMutations';
import { extractRequestMeta } from '@/lib/hr/requestMeta';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string; versionId: string }> },
) {
  const { id: personId, documentId, versionId } = await params;
  const ctx = await requireEmployeeDocumentContext();
  if (!ctx.ok) return ctx.response;

  let resolved;
  try {
    resolved = await requireEmployeeDocumentVersion(
      ctx.session,
      personId,
      documentId,
      versionId,
    );
  } catch (err) {
    console.error('[hr employee document version] resolve failed', err);
    return NextResponse.json({ error: 'Could not retrieve employee document.' }, { status: 500 });
  }
  if (!resolved.ok) return resolved.response;

  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    await logEmployeeDocumentReadEvent(
      {
        organisationId: ctx.session.organisationId,
        userId: ctx.session.userId,
        ipAddress,
        userAgent,
      },
      {
        action: 'hr_employee_document_version.read',
        resourceType: 'hr_employee_document_version',
        resourceId: resolved.version.id,
        afterState: {
          document_id: resolved.version.documentId,
          version_number: resolved.version.versionNumber,
          uploaded_by: resolved.version.uploadedBy,
          original_filename: resolved.version.originalFilename,
          content_type: resolved.version.contentType,
          byte_size: resolved.version.byteSize,
          expires_at: resolved.version.expiresAt,
          is_current: resolved.version.isCurrent,
        },
      },
    );
  } catch (err) {
    console.error('[hr employee document version] read audit failed', err);
    return NextResponse.json(
      { error: 'Unable to record employee document access.' },
      { status: 503 },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await downloadEmployeeDocumentVersionBytes({
      storageKey: resolved.version.storageKey,
    });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === 'NOT_FOUND') {
      return employeeDocumentNotFoundResponse();
    }
    console.error('[hr employee document version] byte retrieval failed', err);
    return NextResponse.json(
      { error: 'The employee document could not be retrieved.' },
      { status: 502 },
    );
  }

  const safeFilename = resolved.version.originalFilename.replace(/["\\\r\n]/g, '');
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': resolved.version.contentType,
      'Content-Disposition': `attachment; filename="${safeFilename || 'file'}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
