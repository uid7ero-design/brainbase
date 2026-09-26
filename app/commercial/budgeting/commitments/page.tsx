'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoneyCents } from '@/lib/commercial/money';

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
  committedCents: number;
  billedCents: number;
  budgetLessCommitmentsCents: number;
  commitmentCount: number;
};

type ExceptionCode =
  | 'UNATTRIBUTED_COST_CENTRE'
  | 'UNMAPPED_ACCOUNT'
  | 'AMBIGUOUS_ACCOUNT'
  | 'UNRESOLVED_PERIOD'
  | 'AMBIGUOUS_PERIOD'
  | 'NO_ACTIVE_BUDGET'
  | 'NO_BUDGET_LINE'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_OVERBILLED';

type ConsumptionException = {
  code: ExceptionCode;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  supplierId: string;
  currency: string;
  financialYearId: string | null;
  financialPeriodId: string | null;
  effectiveCostCentreId: string | null;
  outstandingSubtotalCents: number;
  outstandingTotalCents: number;
  committedCents: number | null;
  budgetId: string | null;
  budgetVersionId: string | null;
};

type Report = {
  rows: ConsumptionRow[];
  exceptions: ConsumptionException[];
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
          : 'Unable to load Budget commitment reporting.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setReport(data.report ?? null);
      setLoading(false);
    })();
  }, []);

  const rows = useMemo(() => report?.rows ?? [], [report]);
  const filteredRows = useMemo(() => rows.filter(row => {
    if (filters.financialYearId !== 'ALL' && row.financialYearId !== filters.financialYearId) return false;
    if (filters.financialPeriodId !== 'ALL' && row.financialPeriodId !== filters.financialPeriodId) return false;
    if (filters.budgetAccountId !== 'ALL' && row.budgetAccountId !== filters.budgetAccountId) return false;
    if (filters.costCentreId !== 'ALL' && row.costCentreId !== filters.costCentreId) return false;
    if (filters.currency !== 'ALL' && row.currency !== filters.currency) return false;
    return true;
  }), [rows, filters]);

  const summaries = useMemo(() => {
    const byCurrency = new Map<string, { committedCents: number; billedCents: number; commitmentCount: number }>();
    for (const row of filteredRows) {
      const current = byCurrency.get(row.currency) ?? { committedCents: 0, billedCents: 0, commitmentCount: 0 };
      current.committedCents += row.committedCents;
      current.billedCents += row.billedCents;
      current.commitmentCount += row.commitmentCount;
      byCurrency.set(row.currency, current);
    }
    return [...byCurrency.entries()]
      .map(([currency, values]) => ({ currency, ...values }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }, [filteredRows]);

  const financialYears = useMemo(() => uniqueOptions(rows.map(row => [row.financialYearId, row.financialYearName])), [rows]);
  const financialPeriods = useMemo(() => uniqueOptions(rows
    .filter(row => filters.financialYearId === 'ALL' || row.financialYearId === filters.financialYearId)
    .map(row => [row.financialPeriodId, row.financialPeriodName])), [rows, filters.financialYearId]);
  const accounts = useMemo(() => uniqueOptions(rows.map(row => [row.budgetAccountId, `${row.budgetAccountCode} — ${row.budgetAccountName}`])), [rows]);
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

  if (loading) return <div style={{ color: MUTED }}>Loading Budget consumption…</div>;
  if (error) return <div style={{ color: '#f87171' }}>{error}</div>;
  if (!report) return <div style={{ color: MUTED }}>No Budget consumption report is available.</div>;

  return (
    <div style={{ maxWidth: 1400 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
          <Link href="/commercial" style={{ color: '#9ca3af' }}>Commercial</Link> / Budgeting
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Budget vs Commitments</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: '7px 0 0' }}>
          ACTIVE Budget versions compared with governed outstanding Purchasing commitments. Actuals are not included.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: 10, marginBottom: 18 }}>
        <StateCard label="Resolved commitments" value={report.resolvedCommitmentCount} tone="#34d399" />
        <StateCard label="Exceptions requiring review" value={report.unresolvedExceptionCount} tone={report.unresolvedExceptionCount ? '#fbbf24' : '#34d399'} />
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <Filter label="Financial year" value={filters.financialYearId} onChange={v => setFilter('financialYearId', v)} options={financialYears} />
          <Filter label="Financial period" value={filters.financialPeriodId} onChange={v => setFilter('financialPeriodId', v)} options={financialPeriods} />
          <Filter label="Budget account" value={filters.budgetAccountId} onChange={v => setFilter('budgetAccountId', v)} options={accounts} />
          <Filter label="Cost centre" value={filters.costCentreId} onChange={v => setFilter('costCentreId', v)} options={costCentres} />
          <Filter label="Currency" value={filters.currency} onChange={v => setFilter('currency', v)} options={currencies.map(v => [v, v])} />
        </div>
        <button onClick={() => setFilters(DEFAULT_FILTERS)} style={{ marginTop: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, borderRadius: 7, padding: '6px 10px', cursor: 'pointer' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginBottom: 14 }}>
              {summaries.map(summary => (
                <div key={summary.currency} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{summary.currency}</div>
                  <MoneyRow label="Committed" cents={summary.committedCents} currency={summary.currency} emphasis />
                  <MoneyRow label="Billed (informational)" cents={summary.billedCents} currency={summary.currency} />
                  <div style={{ color: MUTED, fontSize: 11, marginTop: 8 }}>{summary.commitmentCount} resolved commitment line{summary.commitmentCount === 1 ? '' : 's'}</div>
                </div>
              ))}
            </div>

            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
                <thead>
                  <tr>
                    {['Budget account', 'Cost centre', 'Period', 'Basis', 'Budget', 'Committed', 'Budget less commitments', 'Billed', 'Lines'].map(label => (
                      <th key={label} style={th}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => (
                    <tr key={rowKey(row)}>
                      <td style={td}>
                        <div style={{ fontWeight: 650 }}>{row.budgetAccountCode}</div>
                        <div style={sub}>{row.budgetAccountName}</div>
                      </td>
                      <td style={td}>
                        <div>{row.costCentreCode ?? row.costCentreId}</div>
                        <div style={sub}>{row.costCentreName ?? row.costCentreId}</div>
                      </td>
                      <td style={td}>
                        <div>{row.financialYearName}</div>
                        <div style={sub}>{row.periodisationMode === 'PERIODISED' ? row.financialPeriodName ?? row.financialPeriodId : 'Annual only'}</div>
                      </td>
                      <td style={td}>
                        <div>{row.currency}</div>
                        <div style={sub}>{row.taxBasis}</div>
                      </td>
                      <td style={moneyTd}>{formatMoneyCents(row.periodisationMode === 'PERIODISED' ? row.periodBudgetCents ?? 0 : row.annualBudgetCents, row.currency)}</td>
                      <td style={{ ...moneyTd, fontWeight: 700 }}>{formatMoneyCents(row.committedCents, row.currency)}</td>
                      <td style={moneyTd}>{formatMoneyCents(row.budgetLessCommitmentsCents, row.currency)}</td>
                      <td style={moneyTd}>{formatMoneyCents(row.billedCents, row.currency)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{row.commitmentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: '#6b7280', fontSize: 11, marginTop: 8 }}>
              “Budget less commitments” is a planning measure only. It is not remaining Budget because governed Actuals are not yet included.
            </p>
          </>
        )}
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Exception & reconciliation queue</h2>
          <span style={{ fontSize: 11, color: MUTED }}>Always shown independently of resolved-row filters.</span>
        </div>
        {report.exceptions.length === 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, color: '#34d399' }}>
            No unresolved commitment exceptions.
          </div>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
              <thead>
                <tr>
                  {['Exception', 'Purchase order', 'Line', 'Period', 'Cost centre', 'Currency', 'Outstanding ex tax', 'Outstanding incl tax', 'Budget-basis amount'].map(label => (
                    <th key={label} style={th}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.exceptions.map(item => (
                  <tr key={`${item.purchaseOrderLineId}:${item.code}`}>
                    <td style={td}><ExceptionBadge code={item.code} /></td>
                    <td style={td}>
                      <Link href={`/commercial/purchasing/purchase-orders/${item.purchaseOrderId}`} style={{ color: '#e5e7eb' }}>
                        {item.purchaseOrderId}
                      </Link>
                    </td>
                    <td style={td}>{item.purchaseOrderLineId}</td>
                    <td style={td}>{item.financialPeriodId ?? item.financialYearId ?? 'Unresolved'}</td>
                    <td style={td}>{item.effectiveCostCentreId ?? 'Unattributed'}</td>
                    <td style={td}>{item.currency}</td>
                    <td style={moneyTd}>{formatMoneyCents(item.outstandingSubtotalCents, item.currency)}</td>
                    <td style={moneyTd}>{formatMoneyCents(item.outstandingTotalCents, item.currency)}</td>
                    <td style={moneyTd}>{item.committedCents === null ? 'Unknown until Budget resolves' : formatMoneyCents(item.committedCents, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function rowKey(row: ConsumptionRow) {
  return [row.budgetVersionId, row.budgetAccountId, row.costCentreId, row.financialPeriodId ?? 'ANNUAL', row.currency].join(':');
}

function uniqueOptions(values: Array<[string | null, string | null]>): Array<[string, string]> {
  const map = new Map<string, string>();
  for (const [value, label] of values) if (value) map.set(value, label ?? value);
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label style={{ display: 'grid', gap: 5, fontSize: 11, color: '#6b7280' }}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)} style={{ background: '#0a0c10', color: '#f3f4f6', border: `1px solid ${BORDER}`, borderRadius: 7, padding: '8px 9px' }}>
        <option value="ALL">All</option>
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}

function StateCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: tone, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function ExceptionBadge({ code }: { code: ExceptionCode }) {
  return <span style={{ display: 'inline-block', fontSize: 10, color: '#fbbf24', border: '1px solid #fbbf2455', borderRadius: 999, padding: '3px 7px', whiteSpace: 'nowrap' }}>{code.replaceAll('_', ' ')}</span>;
}

function MoneyRow({ label, cents, currency, emphasis = false }: { label: string; cents: number; currency: string; emphasis?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7, fontSize: 13 }}><span style={{ color: MUTED }}>{label}</span><span style={{ fontWeight: emphasis ? 700 : 500 }}>{formatMoneyCents(cents, currency)}</span></div>;
}

const th = { textAlign: 'left' as const, fontSize: 10, color: '#6b7280', fontWeight: 600, padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' as const };
const td = { fontSize: 12, padding: '12px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' as const };
const moneyTd = { ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
const sub = { color: MUTED, fontSize: 10, marginTop: 3 };
