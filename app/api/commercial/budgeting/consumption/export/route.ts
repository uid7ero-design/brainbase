import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getBudgetActualCommittedReport } from '@/lib/commercial/budgetActualCommitted';
import { buildBudgetConsumptionCsvExports } from '@/lib/commercial/budgetConsumptionExport';
import {
  BUDGET_EXPORT_CONTROLS,
  type BudgetExportView,
} from '@/lib/commercial/budgetExportControls';

function parseView(request: Request): BudgetExportView | null {
  const view = new URL(request.url).searchParams.get('view');
  return view === 'legacy' || view === 'finance' ? view : null;
}

export async function GET(request: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) return auth.response;

  const view = parseView(request);
  if (!view) {
    return NextResponse.json(
      { error: 'view must be legacy or finance.' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const sourceSystemId = view === 'finance'
    ? url.searchParams.get('sourceSystemId')?.trim() || null
    : null;

  const report = await getBudgetActualCommittedReport(
    auth.session.organisationId,
    sourceSystemId,
  );
  const exports = buildBudgetConsumptionCsvExports(report);
  const csv = view === 'finance' ? exports.financeRowsCsv : exports.legacyRowsCsv;
  const filename = BUDGET_EXPORT_CONTROLS[view].filename;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
