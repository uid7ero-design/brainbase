import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    console.error('[HLNA /upload] failed to parse formData:', e);
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const file  = formData.get('file') as File | null;
  const query = formData.get('query') as string | null;

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
