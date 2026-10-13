import { TableContainer, tableStyles, buttonProps } from '@/components/ui/app';
import { reviewBudgetAllocations } from '@/lib/commercial/budgetAllocationReview';
import { formatBudgetAmount } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

type Line = { id: string; budget_account_id: string; cost_centre_id: string; annual_budget_cents: string };
type Allocation = { budget_line_id: string; financial_period_id: string; amount_cents: string };
type Props = {
  currency: string;
  periodised: boolean;
  draft: boolean;
  lines: Line[];
  allocations: Allocation[];
  periods: { id: string; name: string }[];
  accountCode: (id: string) => string;
  centreCode: (id: string) => string;
  onEditLine?: (id: string) => void;
  onRemoveLine?: (id: string) => void;
  onEditAllocation?: (lineId: string, periodId: string) => void;
  onRemoveAllocation?: (lineId: string, periodId: string) => void;
  busy?: boolean;
};

export default function BudgetReview({ currency, periodised, draft, lines, allocations, periods, accountCode, centreCode, onEditLine, onRemoveLine, onEditAllocation, onRemoveAllocation, busy = false }: Props) {
  const editableAllocations = draft && Boolean(onEditAllocation);
  const removableAllocations = draft && Boolean(onRemoveAllocation);
  const allocationActions = editableAllocations || removableAllocations;
  const editable = draft && Boolean(onEditLine);
  const removable = draft && Boolean(onRemoveLine);
  const lineActions = editable || removable;
  const review = reviewBudgetAllocations(lines, allocations);
  const lineById = new Map(lines.map(line => [line.id, line]));
  const periodName = new Map(periods.map(period => [period.id, period.name]));
  const lineOrder = new Map(lines.map((line, index) => [line.id, index]));
  const periodOrder = new Map(periods.map((period, index) => [period.id, index]));
  const orderedAllocations = [...allocations].sort((a, b) =>
    (lineOrder.get(a.budget_line_id) ?? lines.length) - (lineOrder.get(b.budget_line_id) ?? lines.length)
    || (periodOrder.get(a.financial_period_id) ?? periods.length) - (periodOrder.get(b.financial_period_id) ?? periods.length));
  const money = (cents: string) => formatBudgetAmount(cents, currency);
  return <div className={styles.budgetReview}>
    <h3>Budget review</h3>
    <dl className={styles.reviewTotals} aria-label="Budget totals">
      <div><dt>Annual Budget</dt><dd>{money(review.annualTotalCents)}</dd></div>
      {periodised && <div><dt>Allocated to periods</dt><dd>{money(review.allocatedTotalCents)}</dd></div>}
    </dl>
    {periodised && lines.length > 0 && <p className={review.unbalancedLines ? styles.reviewWarning : styles.reviewBalanced}>
      {review.unbalancedLines
        ? `${review.unbalancedLines} ${review.unbalancedLines === 1 ? 'line needs' : 'lines need'} allocation changes. Each line’s period allocations must equal its annual amount before activation.`
        : `All lines are fully allocated.${draft ? ' Check tax basis and commitment mappings before activation.' : ''}`}
    </p>}
    <TableContainer label="Budget setup lines" minWidth={periodised ? 800 : 600}>
      <table className={tableStyles.table}>
        <caption className={styles.reviewCaption}>Budget lines{periodised ? ' and allocation checks' : ''}</caption>
        <thead><tr>{['Account', 'Cost centre', `Annual amount (${currency})`, ...(periodised ? ['Allocated', 'Allocation check'] : []), ...(lineActions ? ['Action'] : [])].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{lines.length ? lines.map((line, index) => {
          const checked = review.lines[index];
          return <tr key={line.id}>
            <td>{accountCode(line.budget_account_id)}</td><td>{centreCode(line.cost_centre_id)}</td><td>{money(line.annual_budget_cents)}</td>
            {periodised && <><td>{money(checked.allocatedCents)}</td><td>{checked.state === 'BALANCED' ? 'Balanced' : checked.state === 'UNDER' ? `${money(checked.differenceCents)} left to allocate` : `${money((-BigInt(checked.differenceCents)).toString())} over allocated`}</td></>}
            {lineActions && <td><div className={styles.reviewActions}>
              {editable && <button {...buttonProps('secondary')} type="button" disabled={busy} aria-label={`Edit ${accountCode(line.budget_account_id)} / ${centreCode(line.cost_centre_id)}`} onClick={() => onEditLine?.(line.id)}>Edit</button>}
              {removable && <button {...buttonProps('secondary')} type="button" disabled={busy} aria-label={`Remove draft line ${accountCode(line.budget_account_id)} / ${centreCode(line.cost_centre_id)}`} onClick={() => onRemoveLine?.(line.id)}>Remove</button>}
            </div></td>}
          </tr>;
        }) : <tr><td colSpan={(periodised ? 5 : 3) + (lineActions ? 1 : 0)}>No Budget lines yet.</td></tr>}</tbody>
      </table>
    </TableContainer>
    {periodised && <TableContainer label="Budget period allocations" minWidth={600}>
      <table className={tableStyles.table}>
        <caption className={styles.reviewCaption}>Period allocations</caption>
        <thead><tr>{['Account', 'Cost centre', 'Period', `Amount (${currency})`, ...(allocationActions ? ['Action'] : [])].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{orderedAllocations.length ? orderedAllocations.map(allocation => {
          const line = lineById.get(allocation.budget_line_id);
          return <tr key={`${allocation.budget_line_id}:${allocation.financial_period_id}`}>
            <td>{line ? accountCode(line.budget_account_id) : 'Unavailable line'}</td><td>{line ? centreCode(line.cost_centre_id) : '—'}</td><td>{periodName.get(allocation.financial_period_id) ?? 'Unavailable period'}</td><td>{money(allocation.amount_cents)}</td>
            {allocationActions && <td><div className={styles.reviewActions}>{editableAllocations && <button {...buttonProps('secondary')} type="button" disabled={busy || !line || !periodName.has(allocation.financial_period_id)} aria-label={`Edit allocation ${line ? accountCode(line.budget_account_id)+' / '+centreCode(line.cost_centre_id) : 'Unavailable line'} / ${periodName.get(allocation.financial_period_id) ?? 'Unavailable period'}`} onClick={() => onEditAllocation?.(allocation.budget_line_id, allocation.financial_period_id)}>Edit</button>}
              {removableAllocations && <button {...buttonProps('secondary')} type="button" disabled={busy || !line || !periodName.has(allocation.financial_period_id)} aria-label={`Remove allocation ${line ? accountCode(line.budget_account_id)+' / '+centreCode(line.cost_centre_id) : 'Unavailable line'} / ${periodName.get(allocation.financial_period_id) ?? 'Unavailable period'}`} onClick={() => onRemoveAllocation?.(allocation.budget_line_id, allocation.financial_period_id)}>Remove</button>}
            </div></td>}
          </tr>;
        }) : <tr><td colSpan={allocationActions ? 5 : 4}>No period allocations yet.</td></tr>}</tbody>
      </table>
    </TableContainer>}
  </div>;
}
