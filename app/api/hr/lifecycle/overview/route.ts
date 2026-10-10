import { NextResponse } from 'next/server';
import { requireLifecycleWorkflowContext } from '@/lib/hr/lifecycleWorkflowRoute';
import { loadRegisterPage } from '@/lib/hr/registerPageQueries';
import { parseRegisterQuery, HR_REGISTER_MAX_BYTES } from '@/lib/hr/registerPaging';

export async function GET(request: Request = new Request('http://localhost/')) {
  try {
    const result = await requireLifecycleWorkflowContext();
    if (!result.ok) {
      result.response.headers.set('Cache-Control', 'private, no-store');
      return result.response;
    }
    let query;
    try { query = parseRegisterQuery(request.url, 'overview'); } catch { return NextResponse.json({ error: 'Invalid register query.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } }); }
    const overview = await loadRegisterPage(result.context.session, 'overview', query);
    if (new TextEncoder().encode(JSON.stringify(overview)).byteLength > HR_REGISTER_MAX_BYTES) throw new Error('Register response too large');
    return NextResponse.json(overview, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load lifecycle overview.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
