'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoneyCents } from '@/lib/commercial/money';
import { BUDGET_EXPORT_CONTROLS } from '@/lib/commercial/budgetExportControls';

const CARD = '#0e1014';
const BORDER = '#1a1d24';
const MUTED = '#9ca3af';

type ConsumptionRow = {
  budgetId: string;
  budgetVersionId: string;
  budgetAccountId: string;
  budgetAccountCode: string;
  budgetAccountName: string;
  costCentreId: string;
  costCentreCode: string | null;
  costCentreName: string | null;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string | null;
  financialPeriodName: string | null;
  currency: string;
  taxBasis: 'EXCLUSIVE' | 'INCLUSIVE';
  periodisationMode: 'ANNUAL_ONLY' | 'PERIODISED';
  annualBudgetCents: number;
  periodBudgetCents: number | null;
  budgetCents: number;
  actualCents: number;
  committedCents: number;
  exposureCents: number;
  budgetLessActualCents: number;
  budgetLessActualAndCommittedCents: number;
  actualLineCount: number;
  commitmentCount: number;
};

type CommitmentException = {
  code: string;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  currency: string;
  financialYearId: string | null;
  financialPeriodId: string | null;
  effectiveCostCentreId: string | null;
  outstandingSubtotalCents: number;
  outstandingTotalCents: number;
  committedCents: number | null;
};

type ActualException = {
  codes: string[];
  supplierBillLineId: string;
  supplierBillId: string;
  supplierBillNumber: string | null;
  sourcePurchaseOrderId: string;
  sourcePurchaseOrderLineId: string;
  currency: string;
  financialYearId: string | null;
  financialPeriodId: string | null;
  financialPeriodName: string | null;
  effectiveCostCentreId: string | null;
  sourceSubtotalCents: number;
  sourceTotalCents: number;
  actualCents: number | null;
  billDate: string | null;
  billDateFinancialPeriodId: string | null;
  billDateFinancialPeriodName: string | null;
  billDateFinancialPeriodStatus: 'OPEN' | 'CLOSED' | null;
};

type ReconciliationException =
  | { source: 'COMMITMENT'; exception: CommitmentException }
  | { source: 'ACTUAL'; exception: ActualException };

export type FinanceRow = {
  budgetId: string | null;
  budgetVersionId: string | null;
  budgetAccountId: string;
  budgetAccountCode: string;
  budgetAccountName: string;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string;
  financialPeriodName: string;
  currency: string;
  taxBasis: 'EXCLUSIVE' | 'INCLUSIVE' | null;
  periodisationMode: 'ANNUAL_ONLY' | 'PERIODISED' | null;
  budgetCents: string;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  effectiveActualCents: string;
  committedCents: string;
  exposureCents: string;
  externalGlActualCents: string | null;
  reconciliationVarianceCents: string | null;
  reconciliationId: string | null;
  reconciliationStatus: 'SIGNED_OFF' | 'STALE' | null;
  sourceSystemId: string | null;
};

type Report = {
  rows: ConsumptionRow[];
  financeRows: FinanceRow[];
  exceptions: ReconciliationException[];
  resolvedActualCount: number;
  resolvedCommitmentCount: number;
  unresolvedExceptionCount: number;
};

type Filters = {
  financialYearId: string;
  financialPeriodId: string;
  budgetAccountId: string;
  costCentreId: string;
  currency: string;
};
const DEFAULT_FILTERS: Filters = {
  financialYearId: 'ALL',
  financialPeriodId: 'ALL',
  budgetAccountId: 'ALL',
  costCentreId: 'ALL',
  currency: 'ALL',
};

export default function BudgetCommitmentsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/commercial/budgeting/consumption');
      if (!res.ok) {
        setError(res.status === 403
          ? 'Budgeting access is required to view Budget consumption.'
          : 'Unable to load Budget vs Actual reporting.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setReport(data.report ?? null);
      setLoading(false);
    })();
  }, []);
  const rows = useMemo(() => report?.rows ?? [], [report]);
  const financeRows = useMemo(() => report?.financeRows ?? [], [report]);
  const filteredRows = useMemo(() => rows.filter(row => {
    if (filters.financialYearId !== 'ALL' && row.financialYearId !== filters.financialYearId) return false;
    if (filters.financialPeriodId !== 'ALL' && row.financialPeriodId !== filters.financialPeriodId) return false;
    if (filters.budgetAccountId !== 'ALL' && row.budgetAccountId !== filters.budgetAccountId) return false;
    if (filters.costCentreId !== 'ALL' && row.costCentreId !== filters.costCentreId) return false;
    if (filters.currency !== 'ALL' && row.currency !== filters.currency) return false;
    return true;
  }), [rows, filters]);

  const summaries = useMemo(() => {
    const byCurrency = new Map<string, {
      budgetCents: number;
      actualCents: number;
      committedCents: number;
      exposureCents: number;
      remainingCents: number;
    }>();
    for (const row of filteredRows) {
      const current = byCurrency.get(row.currency) ?? {
        budgetCents: 0, actualCents: 0, committedCents: 0, exposureCents: 0, remainingCents: 0,
      };
      current.budgetCents += row.budgetCents;
      current.actualCents += row.actualCents;
      current.committedCents += row.committedCents;
      current.exposureCents += row.exposureCents;
      current.remainingCents += row.budgetLessActualAndCommittedCents;
      byCurrency.set(row.currency, current);
    }
    return [...byCurrency.entries()]
      .map(([currency, values]) => ({ currency, ...values }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }, [filteredRows]);

  const financialYears = useMemo(() =>
    uniqueOptions(rows.map(row => [row.financialYearId, row.financialYearName])), [rows]);
  const financialPeriods = useMemo(() => uniqueOptions(rows
    .filter(row => filters.financialYearId === 'ALL' || row.financialYearId === filters.financialYearId)
    .map(row => [row.financialPeriodId, row.financialPeriodName])), [rows, filters.financialYearId]);
  const accounts = useMemo(() =>
    uniqueOptions(rows.map(row => [row.budgetAccountId, `${row.budgetAccountCode} — ${row.budgetAccountName}`])), [rows]);
  const costCentres = useMemo(() => uniqueOptions(rows.map(row => [
    row.costCentreId,
    row.costCentreCode && row.costCentreName
      ? `${row.costCentreCode} — ${row.costCentreName}`
      : row.costCentreName ?? row.costCentreCode ?? row.costCentreId,
  ])), [rows]);
  const currencies = useMemo(() => [...new Set(rows.map(row => row.currency))].sort(), [rows]);
  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(current => {
      const next = { ...current, [key]: value };
      if (key === 'financialYearId') next.financialPeriodId = 'ALL';
      return next;
    });
  }

  if (loading) return (
    <>
      <div style={{ color: MUTED }}>Loading Budget vs Actual…</div>
      <BudgetExportControls legacyAvailable={false} financeAvailable={false} disabledReason="Report is still loading." />
    </>
  );
  if (error) return (
    <>
      <div style={{ color: '#f87171' }}>{error}</div>
      <BudgetExportControls legacyAvailable={false} financeAvailable={false} disabledReason="Exports are unavailable because the report could not be loaded." />
    </>
  );
  if (!report) return (
    <>
      <div style={{ color: MUTED }}>No Budget consumption report is available.</div>
      <BudgetExportControls legacyAvailable={false} financeAvailable={false} disabledReason="No report data is available to export." />
    </>
  );

  return (
    <div style={{ maxWidth: 1450 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
          <Link href="/commercial" style={{ color: '#9ca3af' }}>Commercial</Link> / Budgeting
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Budget vs Actual vs Committed</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: '7px 0 0' }}>
          Actuals use BrainBase&apos;s operational payable basis: POSTED supplier-bill lines recognised on posted_at.
          This is a Budget-management view, not statutory ledger or cash accounting.
        </p>
      </div>

      <BudgetExportControls
        legacyAvailable={rows.length > 0}
        financeAvailable={financeRows.length > 0}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: 10, marginBottom: 18 }}>
        <StateCard label="Resolved Actual lines" value={report.resolvedActualCount} tone="#60a5fa" />
        <StateCard label="Resolved commitment lines" value={report.resolvedCommitmentCount} tone="#34d399" />
        <StateCard label="Exceptions requiring review" value={report.unresolvedExceptionCount}
          tone={report.unresolvedExceptionCount ? '#fbbf24' : '#34d399'} />
      </div>
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <Filter label="Financial year" value={filters.financialYearId}
            onChange={v => setFilter('financialYearId', v)} options={financialYears} />
          <Filter label="Financial period" value={filters.financialPeriodId}
            onChange={v => setFilter('financialPeriodId', v)} options={financialPeriods} />
          <Filter label="Budget account" value={filters.budgetAccountId}
            onChange={v => setFilter('budgetAccountId', v)} options={accounts} />
          <Filter label="Cost centre" value={filters.costCentreId}
            onChange={v => setFilter('costCentreId', v)} options={costCentres} />
          <Filter label="Currency" value={filters.currency}
            onChange={v => setFilter('currency', v)} options={currencies.map(v => [v, v])} />
        </div>
        <button onClick={() => setFilters(DEFAULT_FILTERS)} style={{
          marginTop: 12, border: `1px solid ${BORDER}`, background: 'transparent',
          color: MUTED, borderRadius: 7, padding: '6px 10px', cursor: 'pointer',
        }}>
          Clear filters
        </button>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Resolved Budget consumption</h2>
        {summaries.length === 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, color: MUTED }}>
            No resolved Budget rows match the selected filters.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 12, marginBottom: 14 }}>
              {summaries.map(summary => (
                <div key={summary.currency} style={{
                  background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16,
                }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{summary.currency}</div>
                  <MoneyRow label="Budget" cents={summary.budgetCents} currency={summary.currency} />
                  <MoneyRow label="Actual" cents={summary.actualCents} currency={summary.currency} />
                  <MoneyRow label="Committed" cents={summary.committedCents} currency={summary.currency} />
                  <MoneyRow label="Actual + Committed" cents={summary.exposureCents}
                    currency={summary.currency} emphasis />
                  <MoneyRow label="Budget less Actual + Committed" cents={summary.remainingCents}
                    currency={summary.currency} emphasis />
                </div>
              ))}
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1360 }}>
                <thead><tr>
                  {[
                    'Budget account', 'Cost centre', 'Period', 'Basis', 'Budget', 'Actual', 'Committed',
                    'Actual + Committed', 'Budget less Actual', 'Budget less Actual + Committed', 'Source lines',
                  ].map(label => <th key={label} style={th}>{label}</th>)}
                </tr></thead>
                <tbody>
                  {filteredRows.map(row => (
                    <tr key={rowKey(row)}>
                      <td style={td}><div style={{ fontWeight: 650 }}>{row.budgetAccountCode}</div>
                        <div style={sub}>{row.budgetAccountName}</div></td>
                      <td style={td}><div>{row.costCentreCode ?? row.costCentreId}</div>
                        <div style={sub}>{row.costCentreName ?? row.costCentreId}</div></td>
                      <td style={td}><div>{row.financialYearName}</div>
                        <div style={sub}>{row.periodisationMode === 'PERIODISED'
                          ? row.financialPeriodName ?? row.financialPeriodId : 'Annual only'}</div></td>
                      <td style={td}><div>{row.currency}</div><div style={sub}>{row.taxBasis}</div></td>
                      <td style={moneyTd}>{formatMoneyCents(row.budgetCents, row.currency)}</td>
                      <td style={moneyTd}>{formatMoneyCents(row.actualCents, row.currency)}</td>
                      <td style={moneyTd}>{formatMoneyCents(row.committedCents, row.currency)}</td>
                      <td style={{ ...moneyTd, fontWeight: 700 }}>{formatMoneyCents(row.exposureCents, row.currency)}</td>
                      <td style={moneyTd}>{formatMoneyCents(row.budgetLessActualCents, row.currency)}</td>
                      <td style={{ ...moneyTd, fontWeight: 700 }}>
                        {formatMoneyCents(row.budgetLessActualAndCommittedCents, row.currency)}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {row.actualLineCount} actual / {row.commitmentCount} committed
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: '#6b7280', fontSize: 11, marginTop: 8 }}>
              Budget less Actual + Committed is a planning measure on the Budget&apos;s tax basis.
              It is not cash remaining or a statutory ledger balance.
            </p>
          </>
        )}
      </section>

      <FinanceAdjustedTable rows={financeRows} />

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Exception & reconciliation queue</h2>
          <span style={{ fontSize: 11, color: MUTED }}>Always shown independently of resolved-row filters.</span>
        </div>
        {report.exceptions.length === 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, color: '#34d399' }}>
            No unresolved Actual or Commitment exceptions.
          </div>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
              <thead><tr>
                {['Source', 'Exception', 'Purchase order', 'Source line', 'Period', 'Cost centre', 'Currency',
                  'Ex-tax source', 'Incl-tax source', 'Budget-basis amount'].map(label =>
                  <th key={label} style={th}>{label}</th>)}
              </tr></thead>
              <tbody>
                {report.exceptions.map((item, index) => {
                  const view = exceptionView(item);
                  return (
                    <tr key={`${item.source}:${view.lineId}:${index}`}>
                      <td style={td}><SourceBadge source={item.source} /></td>
                      <td style={td}>{view.codes.map(code => <ExceptionBadge key={code} code={code} />)}</td>
                      <td style={td}><Link href={`/commercial/purchasing/purchase-orders/${view.purchaseOrderId}`}
                        style={{ color: '#e5e7eb' }}>{view.purchaseOrderId}</Link></td>
                      <td style={td}>{view.lineId}</td>
                      <td style={td}>{view.period}</td>
                      <td style={td}>{view.costCentre}</td>
                      <td style={td}>{view.currency}</td>
                      <td style={moneyTd}>{formatMoneyCents(view.exTaxCents, view.currency)}</td>
                      <td style={moneyTd}>{formatMoneyCents(view.inclTaxCents, view.currency)}</td>
                      <td style={moneyTd}>{view.budgetBasisCents === null
                        ? 'Unknown until Budget resolves'
                        : formatMoneyCents(view.budgetBasisCents, view.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function BudgetExportControls({
  legacyAvailable,
  financeAvailable,
  disabledReason = null,
}: {
  legacyAvailable: boolean;
  financeAvailable: boolean;
  disabledReason?: string | null;
}) {
  const controls = [
    { ...BUDGET_EXPORT_CONTROLS.legacy, available: legacyAvailable },
    { ...BUDGET_EXPORT_CONTROLS.finance, available: financeAvailable },
  ];

  return (
    <section
      aria-label="Budget exports"
      style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}
    >
      {controls.map(control => control.available ? (
        <a
          key={control.key}
          href={control.href}
          download={control.filename}
          data-export-view={control.key}
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 7,
            padding: '7px 10px',
            color: '#d1d5db',
            textDecoration: 'none',
            fontSize: 12,
          }}
        >
          {control.label}
        </a>
      ) : (
        <span
          key={control.key}
          aria-disabled="true"
          data-export-view={control.key}
          data-export-filename={control.filename}
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 7,
            padding: '7px 10px',
            color: '#6b7280',
            fontSize: 12,
            cursor: 'not-allowed',
          }}
        >
          {control.label}
        </span>
      ))}
      {disabledReason ? (
        <span role="status" style={{ fontSize: 11, color: '#fbbf24' }}>{disabledReason}</span>
      ) : null}
    </section>
  );
}

export function FinanceAdjustedTable({ rows }: { rows: FinanceRow[] }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Finance-adjusted reporting</h2>
        <span style={{ fontSize: 11, color: MUTED }}>Budget account · period · currency</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, color: MUTED }}>
          No finance-adjusted rows are available.
        </div>
      ) : (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1450 }}>
            <thead><tr>
              {[
                'Budget account', 'Period', 'Currency', 'Budget', 'Source Actual', 'Finance Adjustments',
                'Effective Actual', 'Committed', 'Exposure', 'External GL Actual',
                'Reconciliation Variance', 'Reconciliation',
              ].map(label => <th key={label} style={th}>{label}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={financeRowKey(row)}>
                  <td style={td}>
                    <div style={{ fontWeight: 650 }}>{row.budgetAccountCode}</div>
                    <div style={sub}>{row.budgetAccountName}</div>
                  </td>
                  <td style={td}>
                    <div>{row.financialYearName}</div>
                    <div style={sub}>{row.financialPeriodName}</div>
                  </td>
                  <td style={td}>{row.currency}</td>
                  <td style={moneyTd}>{financeMoney(row.budgetCents, row.currency)}</td>
                  <td style={moneyTd}>{financeMoney(row.sourceActualCents, row.currency)}</td>
                  <td style={moneyTd}>{financeMoney(row.financeAdjustmentCents, row.currency)}</td>
                  <td style={{ ...moneyTd, fontWeight: 700 }}>{financeMoney(row.effectiveActualCents, row.currency)}</td>
                  <td style={moneyTd}>{financeMoney(row.committedCents, row.currency)}</td>
                  <td style={{ ...moneyTd, fontWeight: 700 }}>{financeMoney(row.exposureCents, row.currency)}</td>
                  <td style={moneyTd}>{nullableFinanceMoney(row.externalGlActualCents, row.currency)}</td>
                  <td style={moneyTd}>{nullableFinanceMoney(row.reconciliationVarianceCents, row.currency)}</td>
                  <td style={td}>
                    {row.reconciliationStatus ? (
                      <span
                        data-reconciliation-status={row.reconciliationStatus}
                        style={{
                          display: 'inline-block',
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 999,
                          padding: '3px 7px',
                          color: row.reconciliationStatus === 'STALE' ? '#fbbf24' : '#34d399',
                          border: `1px solid ${row.reconciliationStatus === 'STALE' ? '#fbbf2455' : '#34d39955'}`,
                        }}
                      >
                        {row.reconciliationStatus}
                      </span>
                    ) : '—'}
                    {row.sourceSystemId ? <div style={sub}>{row.sourceSystemId}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function financeMoney(cents: string, currency: string) {
  return formatMoneyCents(Number(cents), currency);
}

function nullableFinanceMoney(cents: string | null, currency: string) {
  return cents === null ? '—' : financeMoney(cents, currency);
}

function financeRowKey(row: FinanceRow) {
  return [row.budgetAccountId, row.financialPeriodId, row.currency].join(':');
}

function exceptionView(item: ReconciliationException) {
  if (item.source === 'ACTUAL') {
    const x = item.exception;
    return {
      codes: x.codes,
      purchaseOrderId: x.sourcePurchaseOrderId,
      lineId: x.supplierBillLineId,
      period: x.billDateFinancialPeriodId
        ? `${x.billDateFinancialPeriodName ?? x.billDateFinancialPeriodId}${x.billDateFinancialPeriodStatus ? ` (${x.billDateFinancialPeriodStatus})` : ''} → ${x.financialPeriodName ?? x.financialPeriodId ?? 'Unresolved recognition'}`
        : x.financialPeriodId ?? x.financialYearId ?? 'Unresolved',
      costCentre: x.effectiveCostCentreId ?? 'Unattributed',
      currency: x.currency,
      exTaxCents: x.sourceSubtotalCents,
      inclTaxCents: x.sourceTotalCents,
      budgetBasisCents: x.actualCents,
    };
  }
  const x = item.exception;
  return {
    codes: [x.code],
    purchaseOrderId: x.purchaseOrderId,
    lineId: x.purchaseOrderLineId,
    period: x.financialPeriodId ?? x.financialYearId ?? 'Unresolved',
    costCentre: x.effectiveCostCentreId ?? 'Unattributed',
    currency: x.currency,
    exTaxCents: x.outstandingSubtotalCents,
    inclTaxCents: x.outstandingTotalCents,
    budgetBasisCents: x.committedCents,
  };
}

function rowKey(row: ConsumptionRow) {
  return [row.budgetVersionId, row.budgetAccountId, row.costCentreId,
    row.financialPeriodId ?? 'ANNUAL', row.currency].join(':');
}

function uniqueOptions(values: Array<[string | null, string | null]>): Array<[string, string]> {
  const map = new Map<string, string>();
  for (const [value, label] of values) if (value) map.set(value, label ?? value);
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function Filter({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>;
}) {
  return <label style={{ display: 'grid', gap: 5, fontSize: 11, color: '#6b7280' }}>
    {label}
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: '#0a0c10', color: '#f3f4f6', border: `1px solid ${BORDER}`,
      borderRadius: 7, padding: '8px 9px',
    }}>
      <option value="ALL">All</option>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
  </label>;
}
function StateCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
    <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 700, color: tone, marginTop: 4 }}>{value}</div>
  </div>;
}

function SourceBadge({ source }: { source: 'ACTUAL' | 'COMMITMENT' }) {
  return <span style={{
    display: 'inline-block', fontSize: 10, border: `1px solid ${source === 'ACTUAL' ? '#60a5fa55' : '#34d39955'}`,
    color: source === 'ACTUAL' ? '#60a5fa' : '#34d399', borderRadius: 999, padding: '3px 7px',
  }}>{source}</span>;
}

function ExceptionBadge({ code }: { code: string }) {
  return <span style={{
    display: 'inline-block', fontSize: 10, color: '#fbbf24', border: '1px solid #fbbf2455',
    borderRadius: 999, padding: '3px 7px', whiteSpace: 'nowrap', margin: '1px 3px 1px 0',
  }}>{code.replaceAll('_', ' ')}</span>;
}

function MoneyRow({ label, cents, currency, emphasis = false }: {
  label: string; cents: number; currency: string; emphasis?: boolean;
}) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7, fontSize: 13 }}>
    <span style={{ color: MUTED }}>{label}</span>
    <span style={{ fontWeight: emphasis ? 700 : 500 }}>{formatMoneyCents(cents, currency)}</span>
  </div>;
}
const th = {
  textAlign: 'left' as const, fontSize: 10, color: '#6b7280', fontWeight: 600,
  padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' as const,
};
const td = {
  fontSize: 12, padding: '12px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' as const,
};
const moneyTd = { ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
const sub = { color: MUTED, fontSize: 10, marginTop: 3 };
