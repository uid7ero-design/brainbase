import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { calendarDay } from '@/lib/commercial/supplierApOverviewModel';
import { getSupplierApOverview } from '@/lib/commercial/supplierApOverview';

const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  const agingDate = new URL(request.url).searchParams.get('aging_date') ?? '';
  try { calendarDay(agingDate); } catch {
    return NextResponse.json({ error: 'aging_date must be a valid YYYY-MM-DD calendar date.' }, { status: 400, headers });
  }
  try {
    const report = await getSupplierApOverview(auth.session.organisationId, agingDate);
    return NextResponse.json({ report }, { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to load supplier AP overview.' }, { status: 500, headers });
  }
}
