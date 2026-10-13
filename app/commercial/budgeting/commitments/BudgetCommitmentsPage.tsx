'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { buildLegacyBudgetSummaries, budgetBasisLabel, hasFinanceSnapshotIdentity, hasCompleteFinanceEvidence } from '@/lib/commercial/budgetReportSummaries';
import { FinanceReportSummaries } from './FinanceReportSummaries';
import { validBudgetReport, validFinanceQueue, validFinanceSources } from '@/lib/commercial/budgetReportingSnapshot';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';
import { FinanceWorkflow } from '../../_components/FinanceWorkflow';
import { fieldControlClassName, tableStyles } from '@/components/ui/app';
import { formatMoneyCents, formatMoneyCentsExact } from '@/lib/commercial/money';
import {
  BUDGET_EXPORT_CONTROLS,
  budgetFinanceExportHref,
  resolveBudgetFinanceSourceSystemId,
} from '@/lib/commercial/budgetExportControls';

const CARD = 'var(--bg-surface)';
const BORDER = 'var(--border)';
const MUTED = 'var(--text-muted)';

export type ConsumptionRow = {
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

export type FinanceReconciliationQueueItem = {
  id: string;
  budgetAccountId: string | null;
  budgetAccountCode: string | null;
  budgetAccountName: string | null;
  externalGlAccountCode: string | null;
  costCentreId: string | null;
  costCentreCode: string | null;
  costCentreName: string | null;
  externalCostCentreCode: string | null;
  currency: string;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlCents: string;
  varianceCents: string;
  sourceActualCount: number;
  externalEntryCount: number;
  outcome:
    | 'VARIANCE'
    | 'UNMAPPED_BRAINBASE_ACCOUNT'
    | 'UNMAPPED_EXTERNAL_GL_ACCOUNT'
    | 'UNMAPPED_COST_CENTRE'
    | 'MISSING_EXTERNAL_ENTRY'
    | 'EXTERNAL_ONLY_ENTRY';
};

export type FinanceReconciliationQueueEntry = {
  id: string;
  financialYearId: string;
  financialYearName: string;
  financialPeriodId: string;
  financialPeriodName: string;
  sourceSystemId: string;
  currency: string;
  status: 'PREPARED' | 'REVIEWED' | 'SIGNED_OFF' | 'STALE';
  closeId: string | null;
  sourceActualCents: string;
  financeAdjustmentCents: string;
  brainbaseEffectiveActualCents: string;
  externalGlTotalCents: string;
  varianceCents: string;
  unresolvedItemCount: number;
  snapshotAt: string;
  preparedAt: string;
  reviewedAt: string | null;
  notes: string | null;
  items: FinanceReconciliationQueueItem[];
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

export function filterFinanceAdjustedRows(
  rows: FinanceRow[],
  filters: {
    financialYearId: string;
    financialPeriodId: string;
    budgetAccountId: string;
    currency: string;
  },
) {
  return rows.filter(row => {
    if (filters.financialYearId !== 'ALL' && row.financialYearId !== filters.financialYearId) return false;
    if (filters.financialPeriodId !== 'ALL' && row.financialPeriodId !== filters.financialPeriodId) return false;
    if (filters.budgetAccountId !== 'ALL' && row.budgetAccountId !== filters.budgetAccountId) return false;
    if (filters.currency !== 'ALL' && row.currency !== filters.currency) return false;
    return true;
  });
}

export function buildBudgetFilterOptions(
  rows: ConsumptionRow[],
  financeRows: FinanceRow[],
  financialYearId: string,
) {
  const inSelectedYear = (row: { financialYearId: string }) =>
    financialYearId === 'ALL' || row.financialYearId === financialYearId;

  return {
    financialYears: uniqueOptions([
      ...rows.map(row => [row.financialYearId, row.financialYearName] as [string, string]),
      ...financeRows.map(row => [row.financialYearId, row.financialYearName] as [string, string]),
    ]),
    financialPeriods: uniqueOptions([
      ...rows.filter(inSelectedYear)
        .map(row => [row.financialPeriodId, row.financialPeriodName] as [string | null, string | null]),
      ...financeRows.filter(inSelectedYear)
        .map(row => [row.financialPeriodId, row.financialPeriodName] as [string, string]),
    ]),
    accounts: uniqueOptions([
      ...rows.map(row => [
        row.budgetAccountId,
        `${row.budgetAccountCode} — ${row.budgetAccountName}`,
      ] as [string, string]),
      ...financeRows.map(row => [
        row.budgetAccountId,
        `${row.budgetAccountCode} — ${row.budgetAccountName}`,
      ] as [string, string]),
    ]),
    costCentres: uniqueOptions(rows.map(row => [
      row.costCentreId,
      row.costCentreCode && row.costCentreName
        ? `${row.costCentreCode} — ${row.costCentreName}`
        : row.costCentreName ?? row.costCentreCode ?? row.costCentreId,
    ])),
    currencies: [...new Set([
      ...rows.map(row => row.currency),
      ...financeRows.map(row => row.currency),
    ])].sort(),
  };
}

export default function BudgetCommitmentsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceSystemIds, setSourceSystemIds] = useState<string[]>([]);
  const [sourceSystemsError, setSourceSystemsError] = useState<string | null>(null);
  const [sourceSystemsRefreshKey, setSourceSystemsRefreshKey] = useState(0);
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [completedReportRead, setCompletedReportRead] = useState<string | null>(null);
  const [completedQueueRead, setCompletedQueueRead] = useState<string | null>(null);
  const [selectedSourceSystemId, setSelectedSourceSystemId] = useState('');
  const [reconciliationQueue, setReconciliationQueue] = useState<FinanceReconciliationQueueEntry[]>([]);
  const [reconciliationQueueLoading, setReconciliationQueueLoading] = useState(true);
  const [reconciliationQueueError, setReconciliationQueueError] = useState<string | null>(null);
  const sourceControl = useRef<HTMLSelectElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const resultError = useRef<HTMLDivElement>(null);
  const reviewRequested = useRef(false);
  const sourceMissing = selectedSourceSystemId !== '' && !sourceSystemIds.includes(selectedSourceSystemId);
  const activeSourceSystemId = resolveBudgetFinanceSourceSystemId(
    sourceSystemIds,
    selectedSourceSystemId,
  );
  const requestKey = `${reportRefreshKey}:${activeSourceSystemId ?? ''}:${sourceMissing}`;
  const reportLoading = loading || completedReportRead !== requestKey;
  const queueLoading = reconciliationQueueLoading || completedQueueRead !== requestKey;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/commercial/budgeting/external-gl/sources', { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setSourceSystemsError('Unable to load External GL sources.');
          return;
        }
        const data = await res.json() as { sourceSystemIds?: unknown };
        if (cancelled) return;
        if (!validFinanceSources(data?.sourceSystemIds)) {
          setSourceSystemsError('Unable to load External GL sources.');
          return;
        }
        setSourceSystemIds(data.sourceSystemIds);
        setSourceSystemsError(null);
        if (sourceSystemsRefreshKey > 0) setReportRefreshKey(current => current + 1);
      } catch {
        if (!cancelled) setSourceSystemsError('Unable to load External GL sources. Use Refresh sources to try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceSystemsRefreshKey]);

  useEffect(() => {
    if (sourceMissing) return;
    let cancelled = false;
    (async () => {
      try {
        const suffix = activeSourceSystemId
          ? `?sourceSystemId=${encodeURIComponent(activeSourceSystemId)}`
          : '';
        const res = await fetch(`/api/commercial/budgeting/consumption${suffix}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 403
            ? 'Budgeting access is required to view Budget consumption.'
            : 'Unable to load Budget vs Actual reporting.');
          setLoading(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const next = data?.report;
        if (!validBudgetReport(next, activeSourceSystemId)) {
          throw new Error('Incomplete report');
        }
        setReport(next);
        setError(null);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError('Unable to load Budget vs Actual reporting. Reload the report to try again.');
        setLoading(false);
      } finally {
        if (!cancelled) setCompletedReportRead(requestKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSourceSystemId, reportRefreshKey, requestKey, sourceMissing]);

  useEffect(() => {
    if (sourceMissing) return;
    let cancelled = false;
    (async () => {
      try {
        const suffix = activeSourceSystemId
          ? `?sourceSystemId=${encodeURIComponent(activeSourceSystemId)}`
          : '';
        const res = await fetch(`/api/commercial/budgeting/reconciliations${suffix}`, {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) {
          setReconciliationQueueError(
            res.status === 403
              ? 'Budgeting access is required to view finance reconciliation items.'
              : 'Unable to load the finance reconciliation queue.',
          );
          setReconciliationQueue([]);
          setReconciliationQueueLoading(false);
          return;
        }

        const data = await res.json() as { reconciliations?: unknown };
        if (cancelled) return;
        if (!validFinanceQueue(data?.reconciliations, activeSourceSystemId)) {
          setReconciliationQueueError('Unable to load the finance reconciliation queue.');
          setReconciliationQueue([]);
          setReconciliationQueueLoading(false);
          return;
        }

        setReconciliationQueue(data.reconciliations as FinanceReconciliationQueueEntry[]);
        setReconciliationQueueError(null);
        setReconciliationQueueLoading(false);
      } catch {
        if (cancelled) return;
        setReconciliationQueueError('Unable to load the finance reconciliation queue. Reload the report to try again.');
        setReconciliationQueueLoading(false);
      } finally {
        if (!cancelled) setCompletedQueueRead(requestKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSourceSystemId, reportRefreshKey, requestKey, sourceMissing]);

  function reloadReport() {
    if (sourceMissing) return;
    reviewRequested.current = true;
    setLoading(true);
    setError(null);
    setReconciliationQueueLoading(true);
    setReconciliationQueueError(null);
    setReportRefreshKey(current => current + 1);
  }

  function selectSourceSystem(value: string) {
    if (value === selectedSourceSystemId || (value !== '' && !sourceSystemIds.includes(value))) return;
    reviewRequested.current = true;
    setLoading(true);
    setError(null);
    setReconciliationQueueLoading(true);
    setReconciliationQueueError(null);
    setSelectedSourceSystemId(value);
  }
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

  const filteredFinanceRows = useMemo(
    () => filterFinanceAdjustedRows(financeRows, filters),
    [financeRows, filters],
  );
  const financeReconciliationItemCount = useMemo(
    () => reconciliationQueue.reduce((total, entry) => total + entry.items.length, 0),
    [reconciliationQueue],
  );

  const summaries = useMemo(() => buildLegacyBudgetSummaries(filteredRows), [filteredRows]);

  const filterOptions = useMemo(
    () => buildBudgetFilterOptions(rows, financeRows, filters.financialYearId),
    [rows, financeRows, filters.financialYearId],
  );
  const {
    financialYears,
    financialPeriods,
    accounts,
    costCentres,
    currencies,
  } = filterOptions;
  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(current => {
      const next = { ...current, [key]: value };
      if (key === 'financialYearId') next.financialPeriodId = 'ALL';
      return next;
    });
  }

  const filterAvailability: Array<[keyof Filters, string, string[]]> = [
    ['financialYearId', 'Financial year', financialYears.map(([id]) => id)],
    ['financialPeriodId', 'Financial period', financialPeriods.map(([id]) => id)],
    ['budgetAccountId', 'Budget account', accounts.map(([id]) => id)],
    ['costCentreId', 'Cost centre', costCentres.map(([id]) => id)],
    ['currency', 'Currency', currencies],
  ];
  const unavailableFilters = filterAvailability.filter(([key, , available]) =>
    filters[key] !== 'ALL' && !available.includes(filters[key]));
  function clearUnavailableFilters() {
    setFilters(current => {
      const next = { ...current };
      for (const [key] of unavailableFilters) next[key] = 'ALL';
      return next;
    });
  }

  useEffect(() => {
    if (sourceMissing) sourceControl.current?.focus();
  }, [sourceMissing]);

  useEffect(() => {
    if (reportLoading || sourceMissing || !reviewRequested.current) return;
    reviewRequested.current = false;
    const target = error ? resultError.current : resultHeading.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'start' });
  }, [reportLoading, sourceMissing, error]);

  const sourceSelector = <FinanceSourceSelector
    sourceSystemIds={sourceSystemIds}
    selectedSourceSystemId={selectedSourceSystemId}
    onChange={selectSourceSystem}
    controlRef={sourceControl}
    onRefresh={() => { reviewRequested.current = true; setSourceSystemsRefreshKey(current => current + 1); }}
    error={sourceSystemsError}
  />;

  if (sourceMissing) return (
    <>
      {sourceSelector}
      <div role="alert" style={{ color: 'var(--status-warning)', marginBottom: 12 }}>
        The selected source is no longer available. Choose another source or BrainBase only, or refresh sources.
      </div>
      <BudgetExportControls legacyAvailable={false} financeAvailable={false} disabledReason="Choose an available source before reviewing or exporting this report." />
    </>
  );
  if (reportLoading) return (
    <>
      {sourceSelector}
      <div role="status" style={{ color: MUTED }}>Loading Budget vs Actual…</div>
      <BudgetExportControls legacyAvailable={false} financeAvailable={false} disabledReason="Report is still loading." />
    </>
  );
  if (error) return (
    <>
      {sourceSelector}
      <div ref={resultError} tabIndex={-1} role="alert" style={{ color: 'var(--status-danger)', scrollMarginTop: 200 }}>{error}</div>
      <button type="button" onClick={reloadReport} className={fieldControlClassName}>Reload report</button>
      <BudgetExportControls legacyAvailable={false} financeAvailable={false} disabledReason="Exports are unavailable because the report could not be loaded." />
    </>
  );
  if (!report) return (
    <>
      <div style={{ color: MUTED }}>No Budget consumption report is available.</div>
      <FinanceWorkflow current="reporting" setupHint="Use Finance setup to configure your calendar, accounts, cost centres and draft Budget. Activate the completed version to make its Budget available for reporting." />
      <BudgetExportControls legacyAvailable={false} financeAvailable={false} disabledReason="No report data is available to export." />
    </>
  );

  return (
    <div style={{ maxWidth: 1450 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          <Link href="/commercial" style={{ color: 'var(--text-muted)' }}>Commercial</Link> / Budgeting
        </div>
        <h1 ref={resultHeading} tabIndex={-1} style={{ fontSize: 24, fontWeight: 700, margin: 0, scrollMarginTop: 200 }}>Budget vs Actual vs Committed</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: '7px 0 0' }}>
          Actuals use BrainBase&apos;s operational payable basis: POSTED supplier-bill lines recognised on posted_at.
          This is a Budget-management view, not statutory ledger or cash accounting.
        </p>
      </div>

      <FinanceWorkflow current="reporting" setupHint={rows.length === 0 && financeRows.length === 0 ? 'No Budget rows are available. Check Finance setup for an active Budget and its lines and commitment mappings. Operational activity or ledger imports may still need to be added separately.' : undefined} />
      {sourceSelector}
      <button type="button" onClick={reloadReport} className={fieldControlClassName} style={{ marginBottom: 12 }}>Reload report</button>
      <BudgetExportControls
        legacyAvailable={rows.length > 0}
        financeAvailable={financeRows.length > 0}
        sourceSystemId={activeSourceSystemId}
      />

      <div role="status" className={styles.reviewNotice}>Report loaded. {activeSourceSystemId ? `Finance source: ${activeSourceSystemId}.` : 'BrainBase only; finance-adjusted rows exclude External GL evidence.'}</div>
      <div className={styles.stateGrid}>
        <StateCard label="Resolved Actual lines" value={report.resolvedActualCount} tone="var(--status-info)" />
        <StateCard label="Resolved commitment lines" value={report.resolvedCommitmentCount} tone="var(--status-success)" />
        <StateCard label="Actual/Commitment exceptions" value={report.unresolvedExceptionCount}
          tone={report.unresolvedExceptionCount ? 'var(--status-warning)' : 'var(--status-success)'} />
        <StateCard
          label="Finance reconciliation items"
          value={queueLoading ? 'Loading…' : reconciliationQueueError ? 'Unavailable' : financeReconciliationItemCount}
          tone={queueLoading ? MUTED : reconciliationQueueError ? 'var(--status-danger)' : financeReconciliationItemCount ? 'var(--status-warning)' : 'var(--status-success)'}
        />
      </div>
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 18 }}>
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
        {unavailableFilters.length > 0 ? <p role="status" className={styles.filterNotice}>Some filters are no longer available in this report: {unavailableFilters.map(([, label]) => label).join(', ')}. <button type="button" onClick={clearUnavailableFilters} className={fieldControlClassName}>Clear unavailable filters</button></p> : null}
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
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 24, color: MUTED }}>
            No resolved Budget rows match the selected filters.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(270px, 100%), 1fr))', gap: 12, marginBottom: 14 }}>
              {summaries.map(summary => (
                <div role="region" aria-label={`Resolved totals ${summary.currency} ${budgetBasisLabel(summary.taxBasis)}`} key={JSON.stringify([summary.currency, summary.taxBasis])} style={{
                  background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 16,
                }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{summary.currency} · {budgetBasisLabel(summary.taxBasis)} · {summary.rowCount} report {summary.rowCount === 1 ? 'row' : 'rows'}</div>
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

            <div role="region" aria-label="Resolved Budget consumption" tabIndex={0} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
              <table className={tableStyles.table} style={{ minWidth: 1360 }}>
                <thead><tr>
                  {[
                    'Budget account', 'Cost centre', 'Period', 'Basis', 'Budget', 'Actual', 'Committed',
                    'Actual + Committed', 'Budget less Actual', 'Budget less Actual + Committed', 'Source lines',
                  ].map(label => <th key={label} scope="col">{label}</th>)}
                </tr></thead>
                <tbody>
                  {filteredRows.map(row => (
                    <tr key={rowKey(row)}>
                      <td><div style={{ fontWeight: 650 }}>{row.budgetAccountCode}</div>
                        <div style={sub}>{row.budgetAccountName}</div></td>
                      <td><div>{row.costCentreCode ?? row.costCentreId}</div>
                        <div style={sub}>{row.costCentreName ?? row.costCentreId}</div></td>
                      <td><div>{row.financialYearName}</div>
                        <div style={sub}>{row.periodisationMode === 'PERIODISED'
                          ? row.financialPeriodName ?? row.financialPeriodId : 'Annual only'}</div></td>
                      <td><div>{row.currency}</div><div style={sub}>{row.taxBasis}</div></td>
                      <td className={tableStyles.num}>{formatMoneyCentsExact(BigInt(row.budgetCents), row.currency)}</td>
                      <td className={tableStyles.num}>{formatMoneyCentsExact(BigInt(row.actualCents), row.currency)}</td>
                      <td className={tableStyles.num}>{formatMoneyCentsExact(BigInt(row.committedCents), row.currency)}</td>
                      <td className={tableStyles.num} style={{ fontWeight: 700 }}>{formatMoneyCentsExact(BigInt(row.exposureCents), row.currency)}</td>
                      <td className={tableStyles.num}>{formatMoneyCentsExact(BigInt(row.budgetLessActualCents), row.currency)}</td>
                      <td className={tableStyles.num} style={{ fontWeight: 700 }}>
                        {formatMoneyCentsExact(BigInt(row.budgetLessActualAndCommittedCents), row.currency)}
                      </td>
                      <td className={tableStyles.num}>
                        {row.actualLineCount} actual / {row.commitmentCount} committed
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
              Budget less Actual + Committed is a planning measure on the Budget&apos;s tax basis.
              It is not cash remaining or a statutory ledger balance.
            </p>
          </>
        )}
      </section>

      <FinanceReportSummaries rows={filteredFinanceRows} />
      <FinanceAdjustedTable rows={filteredFinanceRows} />

      <FinanceReconciliationQueue
        reconciliations={reconciliationQueue}
        loading={queueLoading}
        error={reconciliationQueueError}
        sourceSystemId={activeSourceSystemId}
      />

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Actual & commitment exception queue</h2>
          <span style={{ fontSize: 11, color: MUTED }}>Always shown independently of resolved-row filters.</span>
        </div>
        {report.exceptions.length === 0 ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 20, color: 'var(--status-success)' }}>
            No unresolved Actual or Commitment exceptions.
          </div>
        ) : (
          <div role="region" aria-label="Actual and commitment exceptions" tabIndex={0} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
            <table className={tableStyles.table} style={{ minWidth: 1180 }}>
              <thead><tr>
                {['Source', 'Exception', 'Purchase order', 'Source line', 'Period', 'Cost centre', 'Currency',
                  'Ex-tax source', 'Incl-tax source', 'Budget-basis amount'].map(label =>
                  <th key={label} scope="col">{label}</th>)}
              </tr></thead>
              <tbody>
                {report.exceptions.map((item, index) => {
                  const view = exceptionView(item);
                  return (
                    <tr key={`${item.source}:${view.lineId}:${index}`}>
                      <td><SourceBadge source={item.source} /></td>
                      <td>{view.codes.map(code => <ExceptionBadge key={code} code={code} />)}</td>
                      <td><Link href={`/commercial/purchasing/purchase-orders/${view.purchaseOrderId}`}
                        style={{ color: 'var(--text-primary)' }}>{view.purchaseOrderId}</Link></td>
                      <td>{view.lineId}</td>
                      <td>{view.period}</td>
                      <td>{view.costCentre}</td>
                      <td>{view.currency}</td>
                      <td className={tableStyles.num}>{formatMoneyCents(view.exTaxCents, view.currency)}</td>
                      <td className={tableStyles.num}>{formatMoneyCents(view.inclTaxCents, view.currency)}</td>
                      <td className={tableStyles.num}>{view.budgetBasisCents === null
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

export function FinanceSourceSelector({
  sourceSystemIds,
  selectedSourceSystemId,
  onChange,
  onRefresh,
  error = null,
  controlRef,
}: {
  controlRef?: React.Ref<HTMLSelectElement>;
  sourceSystemIds: string[];
  selectedSourceSystemId: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  error?: string | null;
}) {
  return (
    <section
      aria-label="External GL source"
      style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}
    >
      <label htmlFor="budget-finance-source" style={{ fontSize: 12, color: MUTED }}>
        Finance source
      </label>
      <select
        ref={controlRef}
        id="budget-finance-source"
        className={styles.sourceSelect}
        value={selectedSourceSystemId}
        onChange={event => onChange(event.target.value)}
        style={{
          border: `1px solid ${BORDER}`,
          background: CARD,
          color: 'var(--text-secondary)',
          borderRadius: 7,
          padding: '7px 10px',
          fontSize: 12,
        }}
      >
        <option value="">BrainBase only (no External GL)</option>
        {selectedSourceSystemId && !sourceSystemIds.includes(selectedSourceSystemId) ? <option value={selectedSourceSystemId} disabled>{selectedSourceSystemId} (unavailable)</option> : null}
        {sourceSystemIds.map(sourceSystemId => (
          <option key={sourceSystemId} value={sourceSystemId}>{sourceSystemId}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRefresh}
        style={{
          border: `1px solid ${BORDER}`,
          background: 'transparent',
          color: MUTED,
          borderRadius: 7,
          padding: '7px 10px',
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        Refresh sources
      </button>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Select a source explicitly to include signed-off or stale External GL reconciliation evidence.
      </span>
      {error ? <span role="status" style={{ fontSize: 11, color: 'var(--status-warning)' }}>{error}</span> : null}
    </section>
  );
}

export function BudgetExportControls({
  legacyAvailable,
  financeAvailable,
  sourceSystemId = null,
  disabledReason = null,
}: {
  legacyAvailable: boolean;
  financeAvailable: boolean;
  sourceSystemId?: string | null;
  disabledReason?: string | null;
}) {
  const controls = [
    { ...BUDGET_EXPORT_CONTROLS.legacy, available: legacyAvailable },
    {
      ...BUDGET_EXPORT_CONTROLS.finance,
      href: budgetFinanceExportHref(sourceSystemId),
      available: financeAvailable,
    },
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
            color: 'var(--text-secondary)',
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
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'not-allowed',
          }}
        >
          {control.label}
        </span>
      ))}
      {disabledReason ? (
        <span role="status" style={{ fontSize: 11, color: 'var(--status-warning)' }}>{disabledReason}</span>
      ) : (
        <span data-export-scope="full-report" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          CSV exports include the full report; table filters do not change exported rows.
        </span>
      )}
    </section>
  );
}

export function FinanceAdjustedTable({ rows }: { rows: FinanceRow[] }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Finance-adjusted reporting</h2>
        <span style={{ fontSize: 11, color: MUTED }}>
          Budget account · period · currency · cost-centre filter does not apply
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 20, color: MUTED }}>
          No finance-adjusted rows are available.
        </div>
      ) : (
        <div role="region" aria-label="Finance-adjusted report" tabIndex={0} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', overflowX: 'auto' }}>
          <table className={tableStyles.table} style={{ minWidth: 1450 }}>
            <thead><tr>
              {[
                'Budget account', 'Period', 'Currency', 'Budget basis', 'Budget', 'Source Actual', 'Finance Adjustments',
                'Effective Actual', 'Committed', 'Exposure', 'External GL Actual',
                'Reconciliation Variance', 'Reconciliation',
              ].map(label => <th key={label} scope="col">{label}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={financeRowKey(row)}>
                  <td>
                    <div style={{ fontWeight: 650 }}>{row.budgetAccountCode}</div>
                    <div style={sub}>{row.budgetAccountName}</div>
                  </td>
                  <td>
                    <div>{row.financialYearName}</div>
                    <div style={sub}>{row.financialPeriodName}</div>
                  </td>
                  <td>{row.currency}</td>
                  <td>{budgetBasisLabel(row.taxBasis)}</td>
                  <td className={tableStyles.num}>{row.taxBasis === null ? 'Unavailable' : financeMoney(row.budgetCents, row.currency)}</td>
                  <td className={tableStyles.num}>{financeMoney(row.sourceActualCents, row.currency)}</td>
                  <td className={tableStyles.num}>{financeMoney(row.financeAdjustmentCents, row.currency)}</td>
                  <td className={tableStyles.num} style={{ fontWeight: 700 }}>{financeMoney(row.effectiveActualCents, row.currency)}</td>
                  <td className={tableStyles.num}>{financeMoney(row.committedCents, row.currency)}</td>
                  <td className={tableStyles.num} style={{ fontWeight: 700 }}>{financeMoney(row.exposureCents, row.currency)}</td>
                  <td className={tableStyles.num}>{hasCompleteFinanceEvidence(row) ? nullableFinanceMoney(row.externalGlActualCents, row.currency) : 'Unavailable'}</td>
                  <td className={tableStyles.num}>{hasCompleteFinanceEvidence(row) ? nullableFinanceMoney(row.reconciliationVarianceCents, row.currency) : 'Unavailable'}</td>
                  <td>
                    {hasFinanceSnapshotIdentity(row) ? (
                      <span
                        data-reconciliation-status={row.reconciliationStatus}
                        style={{
                          display: 'inline-block',
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 'var(--radius-lg)',
                          padding: '3px 7px',
                          color: row.reconciliationStatus === 'STALE' ? 'var(--status-warning)' : 'var(--status-success)',
                          border: `1px solid ${row.reconciliationStatus === 'STALE' ? 'var(--status-warning-border)' : 'var(--status-success-border)'}`,
                        }}
                      >
                        {row.reconciliationStatus}
                      </span>
                    ) : 'No identified snapshot'}
                    {!hasCompleteFinanceEvidence(row) ? <div style={sub}>Ledger evidence incomplete</div> : null}
                    {row.reconciliationId ? (
                      <div data-reconciliation-id={row.reconciliationId} style={sub}>
                        Reconciliation {row.reconciliationId}
                      </div>
                    ) : null}
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

export function FinanceReconciliationQueue({
  reconciliations,
  loading,
  error,
  sourceSystemId,
}: {
  reconciliations: FinanceReconciliationQueueEntry[];
  loading: boolean;
  error: string | null;
  sourceSystemId: string | null;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Finance reconciliation queue</h2>
        <span style={{ fontSize: 11, color: MUTED }}>
          {sourceSystemId
            ? `Latest unresolved snapshot for ${sourceSystemId}`
            : 'Latest unresolved snapshots across all External GL sources'}
        </span>
      </div>

      {loading ? (
        <div role="status" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 20, color: MUTED }}>
          Loading finance reconciliation items…
        </div>
      ) : error ? (
        <div role="alert" style={{ background: CARD, border: '1px solid var(--status-danger-border)', borderRadius: 'var(--radius-lg)', padding: 20, color: 'var(--status-danger)' }}>
          {error}
        </div>
      ) : reconciliations.length === 0 ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 20, color: 'var(--status-success)' }}>
          No unresolved finance reconciliation items in the latest snapshots.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {reconciliations.map(reconciliation => (
            <div
              key={reconciliation.id}
              data-finance-reconciliation-id={reconciliation.id}
              style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
            >
              <div style={{ padding: 14, borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {reconciliation.financialYearName} · {reconciliation.financialPeriodName} · {reconciliation.currency}
                  </div>
                  <div style={sub}>
                    {reconciliation.sourceSystemId} · Reconciliation {reconciliation.id}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    data-finance-reconciliation-status={reconciliation.status}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 'var(--radius-lg)',
                      padding: '3px 7px',
                      color: reconciliation.status === 'STALE' ? 'var(--status-warning)' : 'var(--text-secondary)',
                      border: `1px solid ${reconciliation.status === 'STALE' ? 'var(--status-warning-border)' : 'var(--border-strong)'}`,
                    }}
                  >
                    {reconciliation.status}
                  </span>
                  <span style={{ fontSize: 11, color: MUTED }}>
                    {reconciliation.unresolvedItemCount} unresolved
                  </span>
                </div>
              </div>

              <div style={{ padding: '10px 14px', display: 'flex', gap: 18, flexWrap: 'wrap', borderBottom: `1px solid ${BORDER}` }}>
                <SnapshotMeasure label="Source Actual" value={financeMoney(reconciliation.sourceActualCents, reconciliation.currency)} />
                <SnapshotMeasure label="Finance Adjustments" value={financeMoney(reconciliation.financeAdjustmentCents, reconciliation.currency)} />
                <SnapshotMeasure label="Effective Actual" value={financeMoney(reconciliation.brainbaseEffectiveActualCents, reconciliation.currency)} />
                <SnapshotMeasure label="External GL" value={financeMoney(reconciliation.externalGlTotalCents, reconciliation.currency)} />
                <SnapshotMeasure label="Variance" value={financeMoney(reconciliation.varianceCents, reconciliation.currency)} />
                <SnapshotMeasure label="Prepared" value={formatAustralianTimestamp(reconciliation.preparedAt)} />
              </div>

              <div role="region" aria-label={`Reconciliation details ${reconciliation.financialPeriodName} ${reconciliation.sourceSystemId} ${reconciliation.currency}`} tabIndex={0} style={{ overflowX: 'auto' }}>
                <table className={tableStyles.table} style={{ minWidth: 1320 }}>
                  <thead><tr>
                    {[
                      'Outcome', 'Budget account', 'External GL account', 'Cost centre',
                      'External cost centre', 'Currency', 'Source Actual', 'Finance Adjustments',
                      'Effective Actual', 'External GL', 'Variance',
                    ].map(label => <th key={label} scope="col">{label}</th>)}
                  </tr></thead>
                  <tbody>
                    {reconciliation.items.map(item => (
                      <tr key={item.id} data-reconciliation-outcome={item.outcome}>
                        <td><FinanceOutcomeBadge outcome={item.outcome} /></td>
                        <td>
                          {item.budgetAccountCode ? (
                            <>
                              <div style={{ fontWeight: 650 }}>{item.budgetAccountCode}</div>
                              <div style={sub}>{item.budgetAccountName}</div>
                            </>
                          ) : '—'}
                        </td>
                        <td>{item.externalGlAccountCode ?? '—'}</td>
                        <td>
                          {item.costCentreCode ? (
                            <>
                              <div>{item.costCentreCode}</div>
                              <div style={sub}>{item.costCentreName}</div>
                            </>
                          ) : '—'}
                        </td>
                        <td>{item.externalCostCentreCode ?? '—'}</td>
                        <td>{item.currency}</td>
                        <td className={tableStyles.num}>{financeMoney(item.sourceActualCents, item.currency)}</td>
                        <td className={tableStyles.num}>{financeMoney(item.financeAdjustmentCents, item.currency)}</td>
                        <td className={tableStyles.num}>{financeMoney(item.brainbaseEffectiveActualCents, item.currency)}</td>
                        <td className={tableStyles.num}>{financeMoney(item.externalGlCents, item.currency)}</td>
                        <td className={tableStyles.num}>{financeMoney(item.varianceCents, item.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SnapshotMeasure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 12, fontWeight: 650 }}>{value}</div>
    </div>
  );
}

function FinanceOutcomeBadge({ outcome }: { outcome: FinanceReconciliationQueueItem['outcome'] }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10,
      fontWeight: 700,
      borderRadius: 'var(--radius-lg)',
      padding: '3px 7px',
      color: 'var(--status-warning)',
      border: '1px solid var(--status-warning-border)',
      whiteSpace: 'nowrap',
    }}>
      {outcome.replaceAll('_', ' ')}
    </span>
  );
}

function financeMoney(cents: string, currency: string) {
  return formatMoneyCentsExact(cents, currency);
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
  return <label style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
    {label}
    <select className={fieldControlClassName} value={value} onChange={e => onChange(e.target.value)} style={{
      background: 'var(--bg-sunken)', color: 'var(--text-primary)', border: `1px solid ${BORDER}`,
      borderRadius: 7, padding: '8px 9px',
    }}>
      <option value="ALL">All</option>
      {value !== 'ALL' && !options.some(([id]) => id === value) ? <option value={value} disabled>Previously selected (unavailable)</option> : null}
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
  </label>;
}
function StateCard({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return <div role="group" aria-label={label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)', padding: 14 }}>
    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 700, color: tone, marginTop: 4 }}>{value}</div>
  </div>;
}

function SourceBadge({ source }: { source: 'ACTUAL' | 'COMMITMENT' }) {
  return <span style={{
    display: 'inline-block', fontSize: 10, border: `1px solid ${source === 'ACTUAL' ? 'var(--status-info-border)' : 'var(--status-success-border)'}`,
    color: source === 'ACTUAL' ? 'var(--status-info)' : 'var(--status-success)', borderRadius: 'var(--radius-lg)', padding: '3px 7px',
  }}>{source}</span>;
}

function ExceptionBadge({ code }: { code: string }) {
  return <span style={{
    display: 'inline-block', fontSize: 10, color: 'var(--status-warning)', border: '1px solid var(--status-warning-border)',
    borderRadius: 'var(--radius-lg)', padding: '3px 7px', whiteSpace: 'nowrap', margin: '1px 3px 1px 0',
  }}>{code.replaceAll('_', ' ')}</span>;
}

function MoneyRow({ label, cents, currency, emphasis = false }: {
  label: string; cents: string; currency: string; emphasis?: boolean;
}) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 7, fontSize: 13 }}>
    <span style={{ color: MUTED }}>{label}</span>
    <span style={{ fontWeight: emphasis ? 700 : 500, overflowWrap: 'anywhere' }}>{formatMoneyCentsExact(cents, currency)}</span>
  </div>;
}
const sub = { color: MUTED, fontSize: 10, marginTop: 3 };
