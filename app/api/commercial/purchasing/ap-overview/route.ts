import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { calendarDay, parseSupplierApFilters, type SupplierApFilters } from '@/lib/commercial/supplierApOverviewModel';
import { getSupplierApOverview } from '@/lib/commercial/supplierApOverview';

const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  const params = new URL(request.url).searchParams;
  const agingDate = params.get('aging_date') ?? '';
  try { calendarDay(agingDate); } catch {
    return NextResponse.json({ error: 'aging_date must be a valid YYYY-MM-DD calendar date.' }, { status: 400, headers });
  }
  let filters: SupplierApFilters;
  try { filters = parseSupplierApFilters(params); } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid AP filters.' }, { status: 400, headers });
  }
  try {
    const report = await getSupplierApOverview(auth.session.organisationId, agingDate, filters);
    return NextResponse.json({ report }, { headers });
  } catch {
    return NextResponse.json({ error: 'Unable to load supplier AP overview.' }, { status: 500, headers });
  }
}
