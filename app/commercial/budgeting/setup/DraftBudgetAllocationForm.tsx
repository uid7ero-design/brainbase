import type { FormEvent } from 'react';
import { Field, buttonProps, fieldControlClassName } from '@/components/ui/app';
import { budgetCentsToAmount } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

type Option = { id: string; label: string };
type Allocation = { budget_line_id: string; financial_period_id: string; amount_cents: string };
type Props = {
  currency: string;
  busy: boolean;
  allocation?: Allocation;
  lines: Option[];
  periods: Option[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

export default function DraftBudgetAllocationForm({ currency, busy, allocation, lines, periods, onSubmit, onCancel }: Props) {
  return <form aria-label="Period allocation" onSubmit={onSubmit}>
    {allocation && <p>Editing this period’s allocation. The annual amount and other period allocations will be retained; check the allocation balance after saving.</p>}
    <fieldset disabled={busy} className={styles.formGrid}>
      {allocation ? <>
        <Field label="Allocation line">{control => <input {...control} readOnly value={lines.find(line => line.id === allocation.budget_line_id)?.label ?? 'Unavailable line'} className={fieldControlClassName}/>}</Field>
        <input type="hidden" name="budgetLineId" value={allocation.budget_line_id}/>
        <Field label="Allocation period">{control => <input {...control} readOnly value={periods.find(period => period.id === allocation.financial_period_id)?.label ?? 'Unavailable period'} className={fieldControlClassName}/>}</Field>
        <input type="hidden" name="financialPeriodId" value={allocation.financial_period_id}/>
      </> : <>
        <Field label="Allocation line" required>{control => <select {...control} name="budgetLineId" required defaultValue="" className={fieldControlClassName}><option value="">Choose…</option>{lines.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}</Field>
        <Field label="Allocation period" required>{control => <select {...control} name="financialPeriodId" required defaultValue="" className={fieldControlClassName}><option value="">Choose…</option>{periods.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}</Field>
      </>}
      <Field label={`Period amount (${currency})`} required>{control => <input {...control} name="amountCents" required inputMode="decimal" placeholder="0.00" defaultValue={allocation ? budgetCentsToAmount(allocation.amount_cents) : ''} autoFocus={Boolean(allocation)} className={fieldControlClassName}/>}</Field>
      {allocation ? <div className={styles.lineActions}>
        <button {...buttonProps('secondary')} type="submit">Update allocation</button>
        <button {...buttonProps('secondary')} type="button" onClick={onCancel}>Cancel allocation editing</button>
      </div> : <button {...buttonProps('secondary')} type="submit">Save allocation</button>}
    </fieldset>
  </form>;
}
