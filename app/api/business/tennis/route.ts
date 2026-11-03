import { NextRequest, NextResponse } from 'next/server';
import { tennisBusinessAccess } from '@/lib/tennisBusiness/access';
import { businessPeriod, currentBusinessMonth } from '@/lib/tennisBusiness/model';
import { readTennisBusiness } from '@/lib/tennisBusiness/overview';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: NextRequest) {
  const access = await tennisBusinessAccess();
  if (!access.ok) return NextResponse.json({ error: 'Business workspace unavailable.' }, { status: access.status, headers });
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some(key => key !== 'month') || params.getAll('month').length > 1) return NextResponse.json({ error: 'Choose one month.' }, { status: 400, headers });
  const month = params.get('month') ?? currentBusinessMonth();
  try { businessPeriod(month); } catch { return NextResponse.json({ error: 'Choose a valid month.' }, { status: 400, headers }); }
  return NextResponse.json(await readTennisBusiness(access.session.organisationId, access.modules, month), { headers });
}
