import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { calendarDay, parseSupplierApFilters } from '@/lib/commercial/supplierApOverviewModel';
import { getSupplierApExport } from '@/lib/commercial/supplierApOverview';
import { buildSupplierApCsv } from '@/lib/commercial/supplierApCsv';

const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const auth = await authorizeCommercialRequest('purchasing', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) { auth.response.headers.set('Cache-Control', 'no-store'); return auth.response; }
  const params = new URL(request.url).searchParams;
  const agingDate = params.get('aging_date') ?? '';
  const view = params.get('view') ?? 'bills';
  if (view !== 'bills' && view !== 'aging') return NextResponse.json({ error: 'view must be bills or aging.' }, { status: 400, headers });
  let filters;
  try {
    calendarDay(agingDate);
    // Paging is a screen concern; downloads always use the complete filter scope.
    for (const key of ['page', 'supplier_page', 'page_size']) params.delete(key);
    filters = parseSupplierApFilters(params);
  } catch {
    return NextResponse.json({ error: 'Invalid AP export date or filters.' }, { status: 400, headers });
  }
  try {
    const report = await getSupplierApExport(auth.session.organisationId, agingDate, filters);
    return new NextResponse(buildSupplierApCsv(report, view), { headers: { ...headers,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="supplier-ap-${view}-${agingDate}.csv"`,
    } });
  } catch {
    return NextResponse.json({ error: 'Unable to export supplier AP.' }, { status: 500, headers });
  }
}
