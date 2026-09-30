import { NextRequest, NextResponse } from 'next/server';
import { canAcknowledgeEmployeeDocument } from '@/lib/hr/employeeDocumentAccess';
import { acknowledgeEmployeeDocumentVersion } from '@/lib/hr/employeeDocumentAssuranceMutations';
import { requireEmployeeDocumentContext } from '@/lib/hr/employeeDocumentHttp';
import {
  employeeDocumentNotFoundResponse,
  requireEmployeeDocumentVersion,
} from '@/lib/hr/employeeDocumentRoute';
import { extractRequestMeta } from '@/lib/hr/requestMeta';

function acknowledgementForbiddenResponse() {
  return NextResponse.json(
    {
      error: 'Only the linked employee may acknowledge this document version.',
      code: 'acknowledgement_forbidden',
    },
    { status: 403 },
  );
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; documentId: string; versionId: string }>;
  },
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
    console.error('[hr employee document acknowledgement] resolve failed', err);
    return NextResponse.json(
      { error: 'Could not retrieve employee document.' },
      { status: 500 },
    );
  }
  if (!resolved.ok) return resolved.response;

  if (!canAcknowledgeEmployeeDocument(resolved.auth.actor, resolved.auth.target)) {
    return acknowledgementForbiddenResponse();
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const result = await acknowledgeEmployeeDocumentVersion({
      actor: {
        organisationId: ctx.session.organisationId,
        userId: ctx.session.userId,
        isSuperAdmin: ctx.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      personId,
      documentId,
      versionId,
    });

    if (result.outcome === 'version_not_found') {
      return employeeDocumentNotFoundResponse();
    }
    if (result.outcome === 'forbidden') {
      return acknowledgementForbiddenResponse();
    }

    return NextResponse.json(
      {
        acknowledgement: {
          id: result.acknowledgement.id,
          document_version_id: result.acknowledgement.documentVersionId,
          acknowledged_by: result.acknowledgement.acknowledgedBy,
          acknowledged_at: iso(result.acknowledgement.acknowledgedAt),
        },
      },
      { status: result.outcome === 'recorded' ? 201 : 200 },
    );
  } catch (err) {
    console.error('[hr employee document acknowledgement] mutation failed', err);
    return NextResponse.json(
      { error: 'Could not record employee document acknowledgement.' },
      { status: 500 },
    );
  }
}
