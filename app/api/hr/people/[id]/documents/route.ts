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
  createEmployeeDocumentWithVersion,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
} from '@/lib/hr/employeeDocumentMutations';

const CREATE_FIELDS = new Set([
  'document_type',
  'title',
  'lifecycle_task_id',
  'expires_at',
  'file',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: personId } = await params;
  const ctx = await requireEmployeeDocumentContext();
  if (!ctx.ok) return ctx.response;
  if (!isEmployeeDocumentResourceId(personId)) return employeeDocumentNotFoundResponse();

  const adminError = await requireEmployeeDocumentAdmin(ctx.session);
  if (adminError) return adminError;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.', code: 'validation_error' }, { status: 400 });
  }

  const unknownField = [...formData.keys()].find(key => !CREATE_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json(
      { error: `Unknown or server-managed field: ${unknownField}`, code: 'server_managed_field' },
      { status: 400 },
    );
  }

  const documentType = formData.get('document_type');
  const title = formData.get('title');
  const lifecycleTaskRaw = formData.get('lifecycle_task_id');
  const expiresRaw = formData.get('expires_at');
  const file = formData.get('file');

  if (typeof documentType !== 'string' || documentType.trim().length === 0) {
    return NextResponse.json({ error: 'document_type is required.', code: 'validation_error' }, { status: 400 });
  }
  if (typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required.', code: 'validation_error' }, { status: 400 });
  }

  const lifecycleTaskId = typeof lifecycleTaskRaw === 'string' && lifecycleTaskRaw.trim()
    ? lifecycleTaskRaw.trim()
    : null;
  if (lifecycleTaskId && !isEmployeeDocumentResourceId(lifecycleTaskId)) {
    return NextResponse.json({ error: 'lifecycle_task_id must be a UUID.', code: 'validation_error' }, { status: 400 });
  }

  const expiresAt = typeof expiresRaw === 'string' && expiresRaw.trim() ? expiresRaw.trim() : null;
  if (expiresAt && !isIsoDate(expiresAt)) {
    return NextResponse.json({ error: 'expires_at must be YYYY-MM-DD.', code: 'validation_error' }, { status: 400 });
  }
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
    const result = await createEmployeeDocumentWithVersion({
      actor: {
        organisationId: ctx.session.organisationId,
        userId: ctx.session.userId,
        isSuperAdmin: ctx.session.role === 'super_admin',
        ipAddress,
        userAgent,
      },
      personId,
      documentType,
      title,
      lifecycleTaskId,
      originalFilename: file.name || 'file',
      contentType: file.type || 'application/octet-stream',
      bytes: new Uint8Array(await file.arrayBuffer()),
      expiresAt,
    });

    if (result.outcome === 'forbidden') {
      return NextResponse.json(
        { error: 'HR administrator access is required.', code: 'hr_admin_required' },
        { status: 403 },
      );
    }
    if (result.outcome === 'person_not_found') return employeeDocumentNotFoundResponse();
    if (result.outcome === 'lifecycle_task_not_found') {
      return NextResponse.json(
        { error: 'Lifecycle task not found.', code: 'lifecycle_task_not_found' },
        { status: 404 },
      );
    }
    if (result.outcome === 'invalid') {
      return NextResponse.json({ error: result.error, code: 'validation_error' }, { status: 400 });
    }
    if (result.outcome === 'storage_error') {
      return NextResponse.json({ error: 'Could not store employee document.' }, { status: 502 });
    }

    return NextResponse.json(
      { document: result.document, version: result.version },
      { status: 201 },
    );
  } catch (err) {
    console.error('[hr/people/[id]/documents POST] failed', err);
    return NextResponse.json({ error: 'Could not upload employee document.' }, { status: 500 });
  }
}
