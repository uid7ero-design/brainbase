import { NextRequest, NextResponse } from 'next/server';
import { canVerifyEmployeeDocument } from '@/lib/hr/employeeDocumentAccess';
import {
  verifyEmployeeDocumentVersion,
  type EmployeeDocumentVerificationDecision,
} from '@/lib/hr/employeeDocumentAssuranceMutations';
import { requireEmployeeDocumentContext } from '@/lib/hr/employeeDocumentHttp';
import {
  employeeDocumentNotFoundResponse,
  requireEmployeeDocumentVersion,
} from '@/lib/hr/employeeDocumentRoute';
import { extractRequestMeta } from '@/lib/hr/requestMeta';

const FIELDS = new Set(['decision', 'comment']);

function verificationForbiddenResponse() {
  return NextResponse.json(
    {
      error: 'Only an HR administrator may verify this document version.',
      code: 'verification_forbidden',
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
    console.error('[hr employee document verification] resolve failed', err);
    return NextResponse.json(
      { error: 'Could not retrieve employee document.' },
      { status: 500 },
    );
  }
  if (!resolved.ok) return resolved.response;

  if (!canVerifyEmployeeDocument(resolved.auth.actor, resolved.auth.target)) {
    return verificationForbiddenResponse();
  }

  const parsedBody = await req.json().catch(() => null);
  if (
    parsedBody === null
    || typeof parsedBody !== 'object'
    || Array.isArray(parsedBody)
  ) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object.' },
      { status: 400 },
    );
  }

  const body = parsedBody as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json(
      { error: `Unknown or unsupported field: ${unknownField}` },
      { status: 400 },
    );
  }

  if (body.decision !== 'VERIFIED' && body.decision !== 'REJECTED') {
    return NextResponse.json(
      { error: 'decision must be VERIFIED or REJECTED.' },
      { status: 400 },
    );
  }
  if (
    body.comment !== undefined
    && body.comment !== null
    && typeof body.comment !== 'string'
  ) {
    return NextResponse.json(
      { error: 'comment must be a string or null.' },
      { status: 400 },
    );
  }

  const decision = body.decision as EmployeeDocumentVerificationDecision;
  const comment = typeof body.comment === 'string'
    ? body.comment.trim() || null
    : null;
  const { ipAddress, userAgent } = extractRequestMeta(req);

  try {
    const result = await verifyEmployeeDocumentVersion({
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
      decision,
      comment,
    });

    if (result.outcome === 'version_not_found') {
      return employeeDocumentNotFoundResponse();
    }
    if (result.outcome === 'forbidden') {
      return verificationForbiddenResponse();
    }

    return NextResponse.json(
      {
        verification: {
          id: result.verification.id,
          document_version_id: result.verification.documentVersionId,
          verified_by: result.verification.verifiedBy,
          decision: result.verification.decision,
          comment: result.verification.comment,
          verified_at: iso(result.verification.verifiedAt),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[hr employee document verification] mutation failed', err);
    return NextResponse.json(
      { error: 'Could not record employee document verification.' },
      { status: 500 },
    );
  }
}
