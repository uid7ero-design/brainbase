import { reviewBudgetActivation } from '@/lib/commercial/budgetActivationReview';
import styles from './page.module.css';

type Props = Parameters<typeof reviewBudgetActivation>[0] & { mappingFormId?: string; setupNavigation?: boolean };

const setupActions: Record<string, { href: string; label: string }[]> = {
  'Financial year': [{ href: '/commercial/budgeting/finance-controls', label: 'Review financial year controls' }],
  'Budget lines': [{ href: '#budget-line-setup', label: 'Add Budget lines' }],
  'Accounts and cost centres': [
    { href: '#dimension-accounts', label: 'Review Budget accounts' },
    { href: '#dimension-cost-centres', label: 'Review cost centres' },
  ],
  'Period allocations': [{ href: '#budget-allocation-review', label: 'Review allocation amounts' }],
};

export default function BudgetActivationReview(props: Props) {
  const issues = reviewBudgetActivation(props).filter(check => check.issue);
  return <section aria-label="Draft activation checks" className={styles.activationReview}>
    <h3>Before activation</h3>
    {issues.length ? <ul>{issues.map(check => <li key={check.label}>
      <strong>{check.label}: </strong>{check.issue}
      {props.setupNavigation && setupActions[check.label] && <div className={styles.activationLinks}>
        {setupActions[check.label].map(action => <a key={action.href} href={action.href}>{action.label}</a>)}
      </div>}
    </li>)}</ul>
      : <p>No setup issues found in the loaded draft.</p>}
    <p>Confirm the tax basis and commitment mappings before proceeding. Activation locks this version. The server checks the latest records when you activate.</p>
    {props.mappingFormId && <a href={`#${props.mappingFormId}`}>Review commitment mappings</a>}
  </section>;
}
