import { TableContainer, tableStyles, buttonProps } from '@/components/ui/app';
import styles from './page.module.css';

type Dimension = { id: string; code: string; active: boolean };
type Props = {
  mappings: { cost_centre_id: string; budget_account_id: string }[];
  accounts: Dimension[];
  centres: Dimension[];
  draft: boolean;
  busy: boolean;
  onRemove?: (centreId: string) => void;
  onEdit: (centreId: string) => void;
};

export default function BudgetMappingReview({ mappings, accounts, centres, draft, busy, onEdit, onRemove }: Props) {
  const accountById = new Map(accounts.map(row => [row.id, row]));
  const centreById = new Map(centres.map(row => [row.id, row]));
  return <TableContainer label="Saved commitment mappings" minWidth={600} className={styles.mappingReview}>
    <table className={tableStyles.table}>
      <caption className={styles.reviewCaption}>Commitment mappings</caption>
      <thead><tr>{['Cost centre', 'Budget account', 'References', ...(draft ? ['Action'] : [])].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{mappings.length ? mappings.map(mapping => {
        const account = accountById.get(mapping.budget_account_id), centre = centreById.get(mapping.cost_centre_id);
        const issues = [!centre ? 'Cost centre unavailable' : !centre.active ? 'Cost centre inactive' : '', !account ? 'Account unavailable' : !account.active ? 'Account inactive' : ''].filter(Boolean);
        return <tr key={mapping.cost_centre_id}>
          <td>{centre?.code ?? 'Unavailable cost centre'}</td><td>{account?.code ?? 'Unavailable account'}</td><td>{issues.length ? issues.join('; ') : 'Active references'}</td>
          {draft && <td><div className={styles.reviewActions}><button {...buttonProps('secondary')} type="button" disabled={busy} aria-label={`Edit mapping ${centre?.code ?? 'unavailable cost centre'}`} onClick={() => onEdit(mapping.cost_centre_id)}>Edit</button>
            {onRemove && <button {...buttonProps('secondary')} type="button" disabled={busy} aria-label={`Remove mapping ${centre?.code ?? 'unavailable cost centre'}`} onClick={() => onRemove(mapping.cost_centre_id)}>Remove</button>}
          </div></td>}
        </tr>;
      }) : <tr><td colSpan={draft ? 4 : 3}>No commitment mappings saved.</td></tr>}</tbody>
    </table>
  </TableContainer>;
}
