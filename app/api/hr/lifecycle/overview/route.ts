import { NextResponse } from 'next/server';
import { requireLifecycleWorkflowContext } from '@/lib/hr/lifecycleWorkflowRoute';
import { loadLifecycleOverview } from '@/lib/hr/lifecycleOverview';

export async function GET() {
  try {
    const result = await requireLifecycleWorkflowContext();
    if (!result.ok) {
      result.response.headers.set('Cache-Control', 'private, no-store');
      return result.response;
    }
    const overview = await loadLifecycleOverview(result.context.session);
    return NextResponse.json(overview, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load lifecycle overview.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}
