import type { FormEvent } from 'react';
import { Field, buttonProps, fieldControlClassName } from '@/components/ui/app';
import { formatBudgetAmount } from '@/lib/commercial/financeSetupDisplay';
import styles from './page.module.css';

export default function DraftBudgetLineRemoval({ line, account, centre, currency, allocationCount, busy, onSubmit, onCancel }: {
  line: { id: string; annual_budget_cents: string }; account: string; centre: string; currency: string;
  allocationCount: number; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  return <section aria-label="Draft line removal confirmation" className={styles.activationReview}>
    <h3>Remove draft Budget line</h3>
    <p><strong>{account} / {centre}</strong> · {formatBudgetAmount(line.annual_budget_cents, currency)}</p>
    <p>This removes this draft line and its {allocationCount} saved period allocations. Commitment mappings stay in place. Activated versions and financial facts are protected. You can add a replacement draft line afterwards.</p>
    <form aria-label="Remove draft Budget line" onSubmit={onSubmit}>
      <fieldset disabled={busy} className={styles.formGrid}>
        <input type="hidden" name="budgetLineId" value={line.id}/>
        <Field label="Removal reason" required>{control => <input {...control} name="reason" required minLength={3} maxLength={500} autoFocus className={fieldControlClassName}/>}</Field>
        <div className={styles.lineActions}>
          <button {...buttonProps('secondary')} type="submit">Confirm remove draft line</button>
          <button {...buttonProps('secondary')} type="button" onClick={onCancel}>Keep draft line</button>
        </div>
      </fieldset>
    </form>
  </section>;
}
