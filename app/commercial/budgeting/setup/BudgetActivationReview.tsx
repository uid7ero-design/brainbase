import { reviewBudgetActivation } from '@/lib/commercial/budgetActivationReview';
import styles from './page.module.css';

type Props = Parameters<typeof reviewBudgetActivation>[0] & { mappingFormId?: string };

export default function BudgetActivationReview(props: Props) {
  const issues = reviewBudgetActivation(props).filter(check => check.issue);
  return <section aria-label="Draft activation checks" className={styles.activationReview}>
    <h3>Before activation</h3>
    {issues.length ? <ul>{issues.map(check => <li key={check.label}><strong>{check.label}: </strong>{check.issue}</li>)}</ul>
      : <p>No setup issues found in the loaded draft.</p>}
    <p>Confirm the tax basis and commitment mappings before proceeding. Activation locks this version. The server checks the latest records when you activate.</p>
    {props.mappingFormId && <a href={`#${props.mappingFormId}`}>Review commitment mappings</a>}
  </section>;
}
