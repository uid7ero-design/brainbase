import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { budgetBasisLabel, buildFinanceBudgetSummaries } from '@/lib/commercial/budgetReportSummaries';
import type { FinanceRow } from './BudgetCommitmentsPage';
import styles from './page.module.css';

export function FinanceReportSummaries({ rows }: { rows: FinanceRow[] }) {
  const summaries = buildFinanceBudgetSummaries(rows);
  if (summaries.length === 0) return null;
  return <section aria-label="Finance-adjusted totals" style={{ marginBottom: 18 }}>
    <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Finance-adjusted totals</h2>
    <p className={styles.reviewNotice}>Totals cover the filtered account, period and currency rows. Cost-centre filters do not apply. Currency and Budget tax basis stay separate.</p>
    <div className={styles.summaryGrid}>{summaries.map(summary => <div key={JSON.stringify([summary.currency, summary.taxBasis])}
      role="region" aria-label={`Finance totals ${summary.currency} ${budgetBasisLabel(summary.taxBasis)}`} className={styles.summaryCard}>
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>{summary.currency} · {budgetBasisLabel(summary.taxBasis)}</h3>
      <div className={styles.reviewNotice}>{summary.rowCount} report {summary.rowCount === 1 ? 'row' : 'rows'}</div>
      {([
        ['Budget', summary.budgetCents], ['Source Actual', summary.sourceActualCents],
        ['Finance Adjustments', summary.financeAdjustmentCents], ['Effective Actual', summary.effectiveActualCents],
        ['Committed', summary.committedCents], ['Exposure', summary.exposureCents],
        ['External GL evidence', summary.externalGlActualCents], ['Reconciliation variance', summary.reconciliationVarianceCents],
      ] as const).map(([label, value]) => <div className={styles.summaryMeasure} key={label}>
        <span>{label}</span><strong>{value === null ? 'Unavailable' : formatMoneyCentsExact(value, summary.currency)}</strong>
      </div>)}
      <p className={styles.reviewNotice} style={{ marginTop: 12 }}>Ledger evidence covers {summary.evidenceRowCount} of {summary.rowCount} {summary.rowCount === 1 ? 'row' : 'rows'}. Snapshot row statuses: {summary.signedOffRowCount} signed off, {summary.staleRowCount} stale.</p>
      {summary.evidenceRowCount !== summary.rowCount ? <p className={styles.filterNotice}>Incomplete evidence is not a zero ledger total.</p> : null}
      {summary.staleRowCount > 0 ? <p className={styles.filterNotice}>Stale snapshot rows are present. Review reconciliation status before relying on these totals.</p> : null}
    </div>)}</div>
  </section>;
}
