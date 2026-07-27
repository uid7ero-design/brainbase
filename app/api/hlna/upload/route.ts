import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import { stampOrganisationOnFormData } from '@/lib/stampOrganisation';
import { checkRateLimit } from '@/lib/rateLimit';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB — matches /api/upload's existing limit
const ALLOWED_EXTENSIONS = ['xlsx', 'xls', 'csv'];

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await getAuthSession();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!checkRateLimit(`hlna-upload:${session.userId}`, 10, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '900' } });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    console.error('[HLNA /upload] failed to parse formData:', e);
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const file  = formData.get('file') as File | null;
  const query = formData.get('query') as string | null;

  if (file) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large' }, { status: 413 });
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }
  }

  // The client must never be able to select/override the tenant sent to the
  // external HLNA backend — always overwrite with the authenticated session's org.
  stampOrganisationOnFormData(formData, session.organisationId);

  console.log('[HLNA /upload] filename:', file?.name ?? '—');
  console.log('[HLNA /upload] file size (bytes):', file?.size ?? 0);
  console.log('[HLNA /upload] query:', query ?? '—');

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/upload`, { method: 'POST', body: formData });
  } catch (e) {
    console.error('[HLNA /upload] network error reaching backend:', e);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  let data: unknown;
  try {
    data = await backendRes.json();
  } catch {
    const text = await backendRes.text().catch(() => '');
    console.error('[HLNA /upload] backend returned non-JSON (status', backendRes.status, '):', text.slice(0, 500));
    return NextResponse.json({ error: 'Backend returned non-JSON', status: backendRes.status }, { status: 502 });
  }

  console.log('[HLNA /upload] backend status:', backendRes.status);
  console.log('[HLNA /upload] backend response:', JSON.stringify(data));

  return NextResponse.json(data, { status: backendRes.status });
}
