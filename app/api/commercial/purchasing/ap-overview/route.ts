import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { calendarDay, parseSupplierApFilters, parseSupplierApBalanceBasis, type SupplierApBalanceBasis, type SupplierApFilters } from '@/lib/commercial/supplierApOverviewModel';
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
  let basis: SupplierApBalanceBasis;
  try { filters = parseSupplierApFilters(params); basis = parseSupplierApBalanceBasis(params); } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid AP filters.' }, { status: 400, headers });
  }
  try {
    const report = basis === 'CURRENT_POSTED_BILLS' ? await getSupplierApOverview(auth.session.organisationId, agingDate, filters)
      : await getSupplierApOverview(auth.session.organisationId, agingDate, filters, basis);
    return NextResponse.json({ report }, { headers });
  } catch (err) {
    if (err instanceof Error && err.message === 'Supplier AP history is incomplete') return NextResponse.json({ error: 'Historical AP is unavailable because lifecycle timestamps are incomplete or inconsistent.', code: 'AP_HISTORY_INCOMPLETE' }, { status: 409, headers });
    return NextResponse.json({ error: 'Unable to load supplier AP overview.' }, { status: 500, headers });
  }
}
