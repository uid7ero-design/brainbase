import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listLedgerEntryHistory } from '@/lib/commercial/ledgerEntryHistory';
import { validateLedgerHistoryFilters } from '@/lib/commercial/ledgerEntryHistoryModel';

export async function GET(req: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const query = new URL(req.url).searchParams;
  let filters, page: number;
  try {
    const rawPage = query.get('page') ?? '1';
    if (!/^[1-9]\d*$/.test(rawPage)) throw new Error('Choose a valid history page.');
    page = Number(rawPage);
    if (!Number.isSafeInteger(page) || page > 100000) throw new Error('Choose a valid history page.');
    filters = validateLedgerHistoryFilters({ source: query.get('source') ?? '', account: query.get('account') ?? '', currency: query.get('currency') ?? '', from: query.get('from') ?? '', to: query.get('to') ?? '' });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Check history filters.' }, { status: 400 }); }
  const report = await listLedgerEntryHistory(auth.session.organisationId, filters, page);
  return NextResponse.json({ report }, { headers: { 'Cache-Control': 'no-store' } });
}
