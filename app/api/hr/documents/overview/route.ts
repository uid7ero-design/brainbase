import { NextResponse } from 'next/server';
import { requireEmployeeDocumentContext } from '@/lib/hr/employeeDocumentHttp';
import { loadEmployeeDocumentOverview } from '@/lib/hr/employeeDocumentOverview';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  const context = await requireEmployeeDocumentContext();
  if (!context.ok) {
    context.response.headers.set('Cache-Control', headers['Cache-Control']);
    return context.response;
  }
  try {
    return NextResponse.json(await loadEmployeeDocumentOverview(context.session), { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to load document overview.' }, { status: 503, headers });
  }
}
