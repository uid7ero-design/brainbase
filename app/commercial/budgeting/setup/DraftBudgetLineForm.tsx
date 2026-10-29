import type { FormEvent } from 'react';
import { Field, buttonProps, fieldControlClassName } from '@/components/ui/app';
import { budgetCentsToAmount } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

type Option = { id: string; label: string };
type Line = { budget_account_id: string; cost_centre_id: string; annual_budget_cents: string };
type Props = {
  currency: string;
  busy: boolean;
  line?: Line;
  accounts: Option[];
  centres: Option[];
  accountCode: (id: string) => string;
  centreCode: (id: string) => string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

export default function DraftBudgetLineForm({ currency, busy, line, accounts, centres, accountCode, centreCode, onSubmit, onCancel }: Props) {
  return <form aria-label="Budget line" onSubmit={onSubmit}>
    {line && <p>Editing this line’s annual amount. Existing period allocations will be retained; check the allocation balance after saving.</p>}
    <fieldset disabled={busy} className={styles.formGrid}>
      {line ? <>
        <Field label="Line account">{control => <input {...control} readOnly value={accountCode(line.budget_account_id)} className={fieldControlClassName}/>}</Field>
        <input type="hidden" name="budgetAccountId" value={line.budget_account_id}/>
        <Field label="Line cost centre">{control => <input {...control} readOnly value={centreCode(line.cost_centre_id)} className={fieldControlClassName}/>}</Field>
        <input type="hidden" name="costCentreId" value={line.cost_centre_id}/>
      </> : <>
        <Field label="Line account" required>{control => <select {...control} name="budgetAccountId" required defaultValue="" className={fieldControlClassName}><option value="">Choose…</option>{accounts.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}</Field>
        <Field label="Line cost centre" required>{control => <select {...control} name="costCentreId" required defaultValue="" className={fieldControlClassName}><option value="">Choose…</option>{centres.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>}</Field>
      </>}
      <Field label={`Annual amount (${currency})`} required>{control => <input {...control} name="annualBudgetCents" required inputMode="decimal" placeholder="0.00" defaultValue={line ? budgetCentsToAmount(line.annual_budget_cents) : ''} autoFocus={Boolean(line)} className={fieldControlClassName}/>}</Field>
      {line ? <div className={styles.lineActions}>
        <button {...buttonProps('secondary')} type="submit">Update line</button>
        <button {...buttonProps('secondary')} type="button" onClick={onCancel}>Cancel editing</button>
      </div> : <button {...buttonProps('secondary')} type="submit">Save line</button>}
    </fieldset>
  </form>;
}
