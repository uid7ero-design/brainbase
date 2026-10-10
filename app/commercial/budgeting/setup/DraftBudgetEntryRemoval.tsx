import type { FormEvent } from 'react';
import { Field, buttonProps, fieldControlClassName } from '@/components/ui/app';
import styles from './page.module.css';

type Props = {
  kind: 'allocation' | 'mapping'; summary: string; identity: Record<string, string>; busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
};
export default function DraftBudgetEntryRemoval({kind,summary,identity,busy,onSubmit,onCancel}:Props) {
  const label = kind === 'allocation' ? 'period allocation' : 'commitment mapping';
  return <section aria-label={`Draft ${kind} removal confirmation`} className={styles.activationReview}>
    <h3>Remove draft {label}</h3>
    <p><strong>{summary}</strong></p>
    <p>{kind === 'allocation'
      ? 'This removes only this period allocation. The annual amount, other allocations and commitment mappings stay in place. Check the allocation balance before activation.'
      : 'This removes only this cost centre’s commitment mapping. Budget lines and period allocations stay in place. Review commitment routing before activation.'}</p>
    <form aria-label={`Remove draft ${label}`} onSubmit={onSubmit}>
      <fieldset disabled={busy} className={styles.formGrid}>
        {Object.entries(identity).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
        <Field label="Removal reason" required>{control=><input {...control} name="reason" required minLength={3} maxLength={500} autoFocus className={fieldControlClassName}/>}</Field>
        <div className={styles.lineActions}>
          <button {...buttonProps('secondary')} type="submit">Confirm remove {kind}</button>
          <button {...buttonProps('secondary')} type="button" onClick={onCancel}>Keep {kind}</button>
        </div>
      </fieldset>
    </form>
  </section>;
}
