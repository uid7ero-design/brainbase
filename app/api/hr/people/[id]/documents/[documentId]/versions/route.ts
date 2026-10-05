import { NextRequest, NextResponse } from 'next/server';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import {
  employeeDocumentNotFoundResponse,
  isEmployeeDocumentResourceId,
} from '@/lib/hr/employeeDocumentRoute';
import {
  isIsoDate,
  requireEmployeeDocumentAdmin,
  requireEmployeeDocumentContext,
} from '@/lib/hr/employeeDocumentHttp';
import {
  addEmployeeDocumentVersion,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
} from '@/lib/hr/employeeDocumentMutations';
import { listEmployeeDocumentVersions } from '@/lib/hr/employeeDocumentVersionList';

const VERSION_FIELDS = new Set(['expires_at', 'file']);

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id: personId, documentId } = await params;
  const ctx = await requireEmployeeDocumentContext();
  if (!ctx.ok) return ctx.response;
  if (!isEmployeeDocumentResourceId(personId) || !isEmployeeDocumentResourceId(documentId)) {
    return employeeDocumentNotFoundResponse();
  }

  try {
    const result = await listEmployeeDocumentVersions(
      ctx.session,
      personId,
      documentId,
    );
    if (result.outcome === 'not_found') return employeeDocumentNotFoundResponse();

    return NextResponse.json({
      versions: result.versions.map(version => ({
        id: version.id,
        version_number: version.versionNumber,
        expires_at: version.expiresAt ? iso(version.expiresAt) : null,
        is_current: version.isCurrent,
        created_at: iso(version.createdAt),
      })),
    });
  } catch (err) {
    console.error('[hr/people/[id]/documents/[documentId]/versions GET] failed', err);
    return NextResponse.json(
      { error: 'Could not retrieve employee document versions.' },
      { status: 500 },
    );
  }
}

export async function POST(
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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.', code: 'validation_error' }, { status: 400 });
  }

  const unknownField = [...formData.keys()].find(key => !VERSION_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json(
      { error: `Unknown or server-managed field: ${unknownField}`, code: 'server_managed_field' },
      { status: 400 },
    );
  }

  const expiresRaw = formData.get('expires_at');
  const expiresAt = typeof expiresRaw === 'string' && expiresRaw.trim() ? expiresRaw.trim() : null;
  if (expiresAt && !isIsoDate(expiresAt)) {
    return NextResponse.json({ error: 'expires_at must be YYYY-MM-DD.', code: 'validation_error' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.', code: 'validation_error' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_EMPLOYEE_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: file.size === 0 ? 'File is empty.' : 'File exceeds the 20MB limit.', code: 'validation_error' },
      { status: 400 },
    );
  }

  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const result = await addEmployeeDocumentVersion({
      actor: {
        organisationId: ctx.session.organisationId,
        userId: ctx.session.userId,
        isSuperAdmin: ctx.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      personId,
      documentId,
      originalFilename: file.name || 'file',
      contentType: file.type || 'application/octet-stream',
      bytes: new Uint8Array(await file.arrayBuffer()),
      expiresAt,
    });

    if (result.outcome === 'document_not_found') return employeeDocumentNotFoundResponse();
    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }
    if (result.outcome === 'invalid') {
      return NextResponse.json({ error: result.error, code: 'validation_error' }, { status: 400 });
    }
    if (result.outcome === 'storage_error') {
      return NextResponse.json({ error: 'Could not store employee document.' }, { status: 502 });
    }

    return NextResponse.json({ version: result.version }, { status: 201 });
  } catch (err) {
    console.error('[hr/people/[id]/documents/[documentId]/versions POST] failed', err);
    return NextResponse.json({ error: 'Could not add employee document version.' }, { status: 500 });
  }
}
