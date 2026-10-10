import { NextResponse } from 'next/server';
import { requireLifecycleWorkflowContext } from '@/lib/hr/lifecycleWorkflowRoute';
import { loadLifecycleTaskQueue } from '@/lib/hr/lifecycleTaskQueue';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  const context = await requireLifecycleWorkflowContext();
  if (!context.ok) {
    context.response.headers.set('Cache-Control', headers['Cache-Control']);
    return context.response;
  }
  try {
    return NextResponse.json(await loadLifecycleTaskQueue(context.context.session), { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to load lifecycle task queue.' }, { status: 503, headers });
  }
}
