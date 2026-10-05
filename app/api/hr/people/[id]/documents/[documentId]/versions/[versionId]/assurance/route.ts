import { NextResponse } from 'next/server';
import {
  canAcknowledgeEmployeeDocument,
  canVerifyEmployeeDocument,
} from '@/lib/hr/employeeDocumentAccess';
import { getEmployeeDocumentAssuranceStatus } from '@/lib/hr/employeeDocumentAssuranceStatus';
import { requireEmployeeDocumentContext } from '@/lib/hr/employeeDocumentHttp';
import { requireEmployeeDocumentVersion } from '@/lib/hr/employeeDocumentRoute';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function GET(
  _req: Request,
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
    console.error('[hr employee document assurance status] resolve failed', err);
    return NextResponse.json(
      { error: 'Could not retrieve employee document.' },
      { status: 500 },
    );
  }
  if (!resolved.ok) return resolved.response;

  try {
    const status = await getEmployeeDocumentAssuranceStatus({
      organisationId: ctx.session.organisationId,
      versionId: resolved.version.id,
      linkedEmployeeUserId: resolved.auth.target.personLinkedUserId,
    });

    return NextResponse.json({
      assurance: {
        document_version_id: resolved.version.id,
        capabilities: {
          can_acknowledge: canAcknowledgeEmployeeDocument(
            resolved.auth.actor,
            resolved.auth.target,
          ),
          can_verify: canVerifyEmployeeDocument(
            resolved.auth.actor,
            resolved.auth.target,
          ),
        },
        employee_acknowledgement: {
          acknowledged: status.acknowledged,
          acknowledged_at: status.acknowledgedAt ? iso(status.acknowledgedAt) : null,
        },
        latest_verification: status.latestVerification
          ? {
              decision: status.latestVerification.decision,
              verified_at: iso(status.latestVerification.verifiedAt),
            }
          : null,
      },
    });
  } catch (err) {
    console.error('[hr employee document assurance status] read failed', err);
    return NextResponse.json(
      { error: 'Could not retrieve employee document assurance status.' },
      { status: 500 },
    );
  }
}
