import { NextResponse } from 'next/server';
import { requireLifecycleWorkflowContext } from '@/lib/hr/lifecycleWorkflowRoute';
import { loadRegisterPage } from '@/lib/hr/registerPageQueries';
import { parseRegisterQuery, HR_REGISTER_MAX_BYTES } from '@/lib/hr/registerPaging';

export async function GET(request: Request = new Request('http://localhost/')) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const context = await requireLifecycleWorkflowContext();
  if (!context.ok) {
    context.response.headers.set('Cache-Control', headers['Cache-Control']);
    return context.response;
  }
  let query;
  try { query = parseRegisterQuery(request.url, 'queue'); } catch { return NextResponse.json({ error: 'Invalid register query.' }, { status: 400, headers }); }
  try {
    const body = await loadRegisterPage(context.context.session, 'queue', query);
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > HR_REGISTER_MAX_BYTES) throw new Error('Register response too large');
    return NextResponse.json(body, { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to load lifecycle task queue.' }, { status: 503, headers });
  }
}
