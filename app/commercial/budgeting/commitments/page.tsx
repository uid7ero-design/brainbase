'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import {
  applyCommitmentFilters,
  summarizeFilteredCommitments,
  type CommitmentFilters,
  type CommitmentFilterPurchaseOrder,
  type CommitmentResolution,
} from '@/lib/commercial/commitmentReportFilters';

const CARD = '#0e1014';
const BORDER = '#1a1d24';
const MUTED = '#9ca3af';

type Report = {
  periodResolution: CommitmentResolution;
  purchaseOrderCount: number;
  resolvedPurchaseOrderCount: number;
  unresolvedPurchaseOrderCount: number;
  ambiguousPurchaseOrderCount: number;
  purchaseOrders: CommitmentFilterPurchaseOrder[];
};

const DEFAULT_FILTERS: CommitmentFilters = {
  financialYearId: 'ALL',
  financialPeriodId: 'ALL',
  costCentreId: 'ALL',
  supplierId: 'ALL',
  currency: 'ALL',
  resolution: 'ALL',
};

export default function BudgetCommitmentsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [filters, setFilters] = useState<CommitmentFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/commercial/budgeting/commitments');
      if (!res.ok) {
        setError(res.status === 403 ? 'Budgeting access is required to view commitments.' : 'Unable to load commitment reporting.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setReport(data.report ?? null);
      setLoading(false);
    })();
  }, []);

  const purchaseOrders = useMemo(() => report?.purchaseOrders ?? [], [report]);
  const filtered = useMemo(() => applyCommitmentFilters(purchaseOrders, filters), [purchaseOrders, filters]);
  const summaries = useMemo(() => summarizeFilteredCommitments(filtered), [filtered]);

  const financialYears = useMemo(() => uniqueOptions(purchaseOrders.map(po => [po.financialYearId, po.financialYearName])), [purchaseOrders]);
  const financialPeriods = useMemo(() => uniqueOptions(
    purchaseOrders
      .filter(po => filters.financialYearId === 'ALL' || po.financialYearId === filters.financialYearId)
      .map(po => [po.financialPeriodId, po.financialPeriodName]),
  ), [purchaseOrders, filters.financialYearId]);
  const suppliers = useMemo(() => uniqueOptions(purchaseOrders.map(po => [po.supplierId, po.supplierName ?? po.supplierId])), [purchaseOrders]);
  const costCentres = useMemo(() => uniqueOptions(purchaseOrders.flatMap(po => po.lines.map(line => ([
    line.effectiveCostCentreId,
    line.effectiveCostCentreCode && line.effectiveCostCentreName
      ? `${line.effectiveCostCentreCode} — ${line.effectiveCostCentreName}`
      : line.effectiveCostCentreName ?? line.effectiveCostCentreCode ?? 'Unassigned',
  ] as [string | null, string | null])))), [purchaseOrders]);
  const currencies = useMemo(() => [...new Set(purchaseOrders.map(po => po.currency))].sort(), [purchaseOrders]);

  function setFilter<K extends keyof CommitmentFilters>(key: K, value: CommitmentFilters[K]) {
    setFilters(current => {
      const next = { ...current, [key]: value };
      if (key === 'financialYearId') next.financialPeriodId = 'ALL';
      return next;
    });
  }

  if (loading) return <div style={{ color: MUTED }}>Loading Budget commitments…</div>;
  if (error) return <div style={{ color: '#f87171' }}>{error}</div>;
  if (!report) return <div style={{ color: MUTED }}>No commitment report is available.</div>;

  return (
    <div style={{ maxWidth: 1280 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}><Link href="/commercial" style={{ color: '#9ca3af' }}>Commercial</Link> / Budgeting</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Purchase Commitments</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: '7px 0 0' }}>Issued purchase orders, posted supplier bills, and governed financial-period attribution.</p>
        </div>
        <ResolutionBadge resolution={report.periodResolution} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
        <StateCard label="Resolved" value={report.resolvedPurchaseOrderCount} resolution="RESOLVED" />
        <StateCard label="Unresolved" value={report.unresolvedPurchaseOrderCount} resolution="UNRESOLVED" />
        <StateCard label="Ambiguous" value={report.ambiguousPurchaseOrderCount} resolution="AMBIGUOUS" />
      </div>
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10 }}>
          <Filter label="Financial year" value={filters.financialYearId} onChange={v => setFilter('financialYearId', v)} options={financialYears} />
          <Filter label="Financial period" value={filters.financialPeriodId} onChange={v => setFilter('financialPeriodId', v)} options={financialPeriods} />
          <Filter label="Cost centre" value={filters.costCentreId} onChange={v => setFilter('costCentreId', v)} options={costCentres} />
          <Filter label="Supplier" value={filters.supplierId} onChange={v => setFilter('supplierId', v)} options={suppliers} />
          <Filter label="Currency" value={filters.currency} onChange={v => setFilter('currency', v)} options={currencies.map(v => [v, v])} />
          <Filter label="Attribution state" value={filters.resolution} onChange={v => setFilter('resolution', v as CommitmentFilters['resolution'])} options={[
            ['RESOLVED', 'Resolved'], ['UNRESOLVED', 'Unresolved'], ['AMBIGUOUS', 'Ambiguous'],
          ]} />
        </div>
        <button onClick={() => setFilters(DEFAULT_FILTERS)} style={{ marginTop: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, borderRadius: 7, padding: '6px 10px', cursor: 'pointer' }}>Clear filters</button>
      </div>

      {summaries.length === 0 ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, color: MUTED }}>No commitments match the selected filters.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 18 }}>
            {summaries.map(summary => (
              <div key={summary.currency} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{summary.currency}</div>
                <MoneyRow label="Ordered" cents={summary.orderedTotalCents} currency={summary.currency} />
                <MoneyRow label="Billed" cents={summary.billedTotalCents} currency={summary.currency} />
                <MoneyRow label="Outstanding" cents={summary.outstandingTotalCents} currency={summary.currency} emphasis />
              </div>
            ))}
          </div>

          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDER}`, fontSize: 12, color: MUTED }}>{filtered.length} purchase order{filtered.length === 1 ? '' : 's'} shown</div>
            {filtered.map(po => (
              <div key={po.purchaseOrderId} style={{ padding: '16px', borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1.3fr) minmax(140px,1fr) minmax(150px,1fr) repeat(3,minmax(115px,.75fr))', gap: 12, alignItems: 'center' }}>
                  <div>
                    <Link href={`/commercial/purchasing/purchase-orders/${po.purchaseOrderId}`} style={{ color: '#f9fafb', fontWeight: 650, textDecoration: 'none' }}>{po.supplierName ?? po.supplierId}</Link>
                    <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>{po.commitmentEffectiveAt ? formatCommercialDate(po.commitmentEffectiveAt.slice(0, 10)) : 'No issue date'}</div>
                  </div>
                  <div style={{ fontSize: 12 }}>
                    <div>{po.financialYearName ?? 'No financial year'}</div>
                    <div style={{ color: MUTED, marginTop: 3 }}>{po.financialPeriodName ?? 'No financial period'}</div>
                  </div>
                  <ResolutionBadge resolution={po.periodResolution} compact />
                  <MoneyCell label="Ordered" cents={po.orderedTotalCents} currency={po.currency} />
                  <MoneyCell label="Billed" cents={po.billedTotalCents} currency={po.currency} />
                  <MoneyCell label="Outstanding" cents={po.outstandingTotalCents} currency={po.currency} emphasis />
                </div>
                {filters.costCentreId !== 'ALL' && (
                  <div style={{ marginTop: 10, color: MUTED, fontSize: 11 }}>
                    Showing {po.visibleLines.length} matching line{po.visibleLines.length === 1 ? '' : 's'} for the selected cost centre.
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function uniqueOptions(values: Array<[string | null, string | null]>): Array<[string, string]> {
  const map = new Map<string, string>();
  for (const [value, label] of values) if (value) map.set(value, label ?? value);
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label style={{ display: 'grid', gap: 5, fontSize: 11, color: '#6b7280' }}>{label}
    <select value={value} onChange={e => onChange(e.target.value)} style={{ background: '#0a0c10', color: '#f3f4f6', border: `1px solid ${BORDER}`, borderRadius: 7, padding: '8px 9px' }}>
      <option value="ALL">All</option>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
  </label>;
}

function StateCard({ label, value, resolution }: { label: string; value: number; resolution: CommitmentResolution }) {
  return <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
    <div style={{ fontSize: 11, color: '#6b7280' }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 700, margin: '4px 0 8px' }}>{value}</div>
    <ResolutionBadge resolution={resolution} compact />
  </div>;
}

function ResolutionBadge({ resolution, compact = false }: { resolution: CommitmentResolution; compact?: boolean }) {
  const tone = resolution === 'RESOLVED' ? '#34d399' : resolution === 'AMBIGUOUS' ? '#f87171' : '#fbbf24';
  const text = resolution === 'RESOLVED' ? 'RESOLVED' : resolution === 'AMBIGUOUS' ? 'AMBIGUOUS — REVIEW PERIODS' : 'UNRESOLVED — NO MATCH';
  return <span style={{ display: 'inline-block', fontSize: compact ? 10 : 11, color: tone, border: `1px solid ${tone}55`, borderRadius: 999, padding: compact ? '3px 7px' : '5px 9px' }}>{text}</span>;
}

function MoneyRow({ label, cents, currency, emphasis = false }: { label: string; cents: number; currency: string; emphasis?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7, fontSize: 13 }}><span style={{ color: MUTED }}>{label}</span><span style={{ fontWeight: emphasis ? 700 : 500 }}>{formatMoneyCents(cents, currency)}</span></div>;
}

function MoneyCell({ label, cents, currency, emphasis = false }: { label: string; cents: number; currency: string; emphasis?: boolean }) {
  return <div><div style={{ fontSize: 10, color: '#6b7280' }}>{label}</div><div style={{ fontSize: 12, fontWeight: emphasis ? 700 : 500, marginTop: 3 }}>{formatMoneyCents(cents, currency)}</div></div>;
}
