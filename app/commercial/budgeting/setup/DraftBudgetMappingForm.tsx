import { useState, type FormEvent } from 'react';
import { Field, buttonProps, fieldControlClassName } from '@/components/ui/app';
import styles from './page.module.css';

type Dimension = { id: string; code: string; active: boolean };
type Mapping = { cost_centre_id: string; budget_account_id: string };
type Props = {
  busy: boolean;
  mapping?: Mapping;
  accounts: Dimension[];
  centres: Dimension[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

export default function DraftBudgetMappingForm({ busy, mapping, accounts, centres, onSubmit, onCancel }: Props) {
  const [accountId, setAccountId] = useState(mapping?.budget_account_id ?? '');
  const currentAccount = accounts.find(row => row.id === mapping?.budget_account_id);
  const currentCentre = centres.find(row => row.id === mapping?.cost_centre_id);
  const accountUnavailable = mapping && !currentAccount?.active;
  return <form aria-label="Commitment mapping" onSubmit={onSubmit} onReset={() => setAccountId(mapping?.budget_account_id ?? '')}>
    {mapping && <p>Editing the account used for this cost centre. Updating replaces its saved account; Budget amounts and period allocations stay unchanged.</p>}
    <fieldset disabled={busy} className={styles.formGrid}>
      {mapping ? <>
        <Field label="Mapping cost centre" helper={!currentCentre?.active ? 'Reactivate this cost centre before updating its mapping.' : undefined}>{control => <input {...control} readOnly value={currentCentre?.code ?? 'Unavailable cost centre'} className={fieldControlClassName}/>}</Field>
        <input type="hidden" name="costCentreId" value={mapping.cost_centre_id}/>
      </> : <Field label="Mapping cost centre" required>{control => <select {...control} name="costCentreId" required defaultValue="" className={fieldControlClassName}><option value="">Choose…</option>{centres.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.code}</option>)}</select>}</Field>}
      <Field label="Mapping account" required helper={accountUnavailable ? 'Choose an active account or reactivate the saved account before updating.' : undefined}>{control => <select {...control} name="budgetAccountId" required value={accountId} onChange={event => setAccountId(event.target.value)} autoFocus={Boolean(mapping)} className={fieldControlClassName}>
        <option value="">Choose…</option>
        {accountUnavailable && <option value={mapping.budget_account_id} disabled>{currentAccount?.code ?? 'Unavailable account'} (inactive or unavailable)</option>}
        {accounts.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.code}</option>)}
      </select>}</Field>
      {mapping ? <div className={styles.lineActions}>
        <button {...buttonProps('secondary')} type="submit" disabled={!currentCentre?.active || !accounts.some(row => row.id === accountId && row.active)}>Update mapping</button>
        <button {...buttonProps('secondary')} type="button" onClick={onCancel}>Cancel mapping editing</button>
      </div> : <button {...buttonProps('secondary')} type="submit">Save commitment mapping</button>}
    </fieldset>
    <p>Each cost centre routes commitments to one Budget account. Saving a mapping for the same cost centre replaces its previous account.</p>
  </form>;
}
