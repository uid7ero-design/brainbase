import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  employeeDocumentNotFoundResponse,
  isEmployeeDocumentResourceId,
} from '@/lib/hr/employeeDocumentRoute';
import {
  requireEmployeeDocumentAdmin,
  requireEmployeeDocumentContext,
} from '@/lib/hr/employeeDocumentHttp';
import { softDeleteEmployeeDocument } from '@/lib/hr/employeeDocumentMutations';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id: personId, documentId } = await params;
  const ctx = await requireEmployeeDocumentContext();
  if (!ctx.ok) return ctx.response;
  if (!isEmployeeDocumentResourceId(personId) || !isEmployeeDocumentResourceId(documentId)) {
    return employeeDocumentNotFoundResponse();
  }

  const adminError = await requireEmployeeDocumentAdmin(ctx.session);
  if (adminError) return adminError;

  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const result = await softDeleteEmployeeDocument({
      actor: {
        organisationId: ctx.session.organisationId,
        userId: ctx.session.userId,
        isSuperAdmin: ctx.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      personId,
      documentId,
    });

    if (result.outcome === 'document_not_found') return employeeDocumentNotFoundResponse();
    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }

    return NextResponse.json({
      deleted: true,
      document_id: documentId,
      deleted_at: result.deletedAt,
    });
  } catch (err) {
    console.error('[hr/people/[id]/documents/[documentId] DELETE] failed', err);
    return NextResponse.json({ error: 'Could not delete employee document.' }, { status: 500 });
  }
}
