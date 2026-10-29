import Link from 'next/link';
import { PageHeader } from '@/components/ui/app/PageHeader';
import styles from './help.module.css';

export default function FinanceHelp({ purchasing, budgeting, budgetingAdmin }: {
  purchasing: boolean; budgeting: boolean; budgetingAdmin: boolean;
}) {
  return <article className={styles.guide}>
    <PageHeader title="Finance Help & How to" description="Start small, keep your records clear, and use advanced controls when you need them." />
    <nav aria-label="Finance help topics" className={styles.topics}>
      <a href="#getting-started">Getting started</a><a href="#everyday-tasks">Everyday tasks</a>
      <a href="#starter-budget">Starter budget</a><a href="#finance-terms">Finance terms</a>
      <a href="#advanced-controls">Advanced controls</a><a href="#need-help">When something is blocked</a>
    </nav>
    <p>This guide explains the existing workflows. Reading it creates no records. Available screens and actions depend on your organisation’s enabled features and your role.</p>

    <section id="getting-started" className={styles.section} aria-labelledby="getting-started-title">
      <h2 id="getting-started-title">Getting started</h2>
      <p>For a small operation, begin with one cost centre and the spending categories you actually need. Finance Setup requires a budgeting administrator.</p>
      <ol>
        <li><strong>Create your financial year and periods.</strong> Use DD/MM/YYYY dates. Periods must fit inside the year and must not overlap. For example, a July–June year can have four quarters.</li>
        <li><strong>Create Budget accounts.</strong> These describe what you spend on, such as SOFTWARE and HOSTING. A Budget account is a spending category, not a bank account.</li>
        <li><strong>Create a cost centre.</strong> This describes where the spending belongs. GENERAL is enough for a simple starter budget.</li>
        <li><strong>Create a draft Budget.</strong> Choose the year, currency, tax basis and annual-only or periodised amounts. Keep the same currency and tax basis when preparing your figures.</li>
        <li><strong>Add Budget lines.</strong> Choose an account and cost centre, then enter the annual amount as dollars and cents, such as 6408.00. For a periodised Budget, allocations across the periods must equal each line’s annual amount.</li>
        <li><strong>Review commitment mappings.</strong> These select the Budget account used for purchase-order commitments in each mapped cost centre. Check that the mapping reflects how you intend to report spending.</li>
        <li><strong>Review, then activate.</strong> Check the totals, allocations and mappings first. Activation makes the version available for reporting and locks its normal setup editing.</li>
      </ol>
      {budgetingAdmin ? <Link href="/commercial/budgeting/setup">Open Finance Setup</Link> : null}
    </section>

    <section id="everyday-tasks" className={styles.section} aria-labelledby="everyday-tasks-title">
      <h2 id="everyday-tasks-title">Everyday tasks</h2>
      <div className={styles.tasks}>
        <section><h3>Enter a supplier bill</h3><p>Create the supplier and purchase order first, issue the order, then create a supplier bill against it. Enter the supplier’s invoice number and check the lines, currency and dates. Save as draft while checking. Posting creates the payable and freezes normal line editing.</p>
          {purchasing ? <Link href="/commercial/purchasing/supplier-bills">Open Supplier Bills</Link> : null}</section>
        <section><h3>Record a payment</h3><p>After making the payment outside BrainBase, open the posted bill and use Record Payment. Check the amount, date, method and reference, then inspect its payment history and remaining balance. Recording a payment does not transfer money from your bank.</p></section>
        <section><h3>Correct a recorded payment</h3><p>An administrator can use Reverse Payment and provide a reason, then record the correct payment if needed. The original entry remains in history. Reversal changes BrainBase’s record; it does not refund or undo a bank transfer. Active payments must be reversed before a bill can be cancelled.</p></section>
        <section><h3>Check what you owe</h3><p>Use AP Overview for outstanding supplier balances and overdue amounts. Check the balance basis, aging date, currency and supplier filters. Current balances aged at an earlier date are not a historical balance report.</p>
          {purchasing ? <Link href="/commercial/purchasing/ap-overview">Open AP Overview</Link> : null}</section>
        <section><h3>Check your budget</h3><p>Use Budget vs Actual and check the selected year, period, cost centre and currency. Budget Actual comes from posted supplier-bill lines. Paying a bill updates supplier settlement separately; it does not create another Budget Actual expense.</p>
          {budgeting ? <Link href="/commercial/budgeting/commitments">Open Budget vs Actual</Link> : null}</section>
        <section><h3>Download evidence</h3><p>Use the download controls on the relevant report or saved evidence view. Check whether an export covers the displayed page or all matching records. Open a downloaded printable HTML report in your browser and use Print to save it as PDF. A download is a copy, not a backup you can restore into BrainBase.</p></section>
      </div>
    </section>

    <section id="starter-budget" className={styles.section} aria-labelledby="starter-budget-title">
      <h2 id="starter-budget-title">A small starter budget</h2>
      <p>Illustrative AUD amounts for a full 12-month year. Replace these with your own confirmed costs; check each invoice’s currency and use the tax basis chosen for your Budget. Nothing here is added automatically.</p>
      <div className={styles.tableScroll} role="region" aria-label="Starter subscription costs" tabIndex={0}>
        <table><caption>Example recurring costs in AUD</caption><thead><tr><th scope="col">Service</th><th scope="col">Monthly</th><th scope="col">Annual</th><th scope="col">Budget account</th></tr></thead>
          <tbody>
            <tr><th scope="row">Claude</th><td>340.00</td><td>4,080.00</td><td>SOFTWARE</td></tr>
            <tr><th scope="row">ChatGPT</th><td>154.00</td><td>1,848.00</td><td>SOFTWARE</td></tr>
            <tr><th scope="row">Business email and Microsoft 365</th><td>40.00</td><td>480.00</td><td>SOFTWARE</td></tr>
            <tr><th scope="row">Vercel</th><td>20.00</td><td>240.00</td><td>HOSTING</td></tr>
            <tr><th scope="row">Neon</th><td>20.00</td><td>240.00</td><td>HOSTING</td></tr>
          </tbody><tfoot><tr><th scope="row">Total</th><td>574.00</td><td>6,888.00</td><td>GENERAL cost centre</td></tr></tfoot>
        </table>
      </div>
      <p>In GENERAL, create a SOFTWARE line for <strong>AUD 6,408.00</strong> and a HOSTING line for <strong>AUD 480.00</strong>. For four equal quarters, allocate <strong>1,602.00</strong> to SOFTWARE and <strong>120.00</strong> to HOSTING in each quarter: <strong>AUD 1,722.00 per quarter</strong>.</p>
      <p>Enter 6408.00 in the annual amount field, rather than converting it to cents. Keep your time as a separate planning note when estimating cash spending. Equipment you already own does not need a new purchase in this example.</p>
    </section>

    <section id="finance-terms" className={styles.section} aria-labelledby="finance-terms-title">
      <h2 id="finance-terms-title">Finance terms in plain English</h2>
      <dl className={styles.terms}>
        <div><dt>Budget</dt><dd>The amount you plan to spend for a selected account, cost centre and time period.</dd></div>
        <div><dt>Committed</dt><dd>The outstanding purchase-order commitment included under the report’s selected basis. It represents spending already committed through orders.</dd></div>
        <div><dt>Budget Actual</dt><dd>The value of posted supplier-bill lines under BrainBase’s reporting rules. It is not a bank balance or a tax calculation.</dd></div>
        <div><dt>Outstanding / payable</dt><dd>The supplier-bill amount still owing after recorded payments and reversals.</dd></div>
        <div><dt>Reversal</dt><dd>A recorded correction that retains the original entry and its history. It does not move money at your bank.</dd></div>
        <div><dt>Finance adjustment</dt><dd>A separately recorded correction considered alongside source Actual. It does not rewrite the original supplier-bill fact.</dd></div>
        <div><dt>Reconciliation</dt><dd>A comparison of BrainBase’s effective Actual with imported external general-ledger records for the chosen scope.</dd></div>
        <div><dt>Snapshot</dt><dd>A saved version of evidence at a point in time. An earlier snapshot can remain readable even when later activity makes it stale.</dd></div>
        <div><dt>Close / sign-off</dt><dd>Governed period controls and a recorded review decision. An empty list or zero variance alone does not establish that sign-off is ready.</dd></div>
      </dl>
    </section>

    <section id="advanced-controls" className={styles.section} aria-labelledby="advanced-controls-title">
      <h2 id="advanced-controls-title">Advanced controls — for later</h2>
      <p>You can start with budget setup, bills and payments. External ledger reconciliation is a separate workflow when you have ledger evidence to compare.</p>
      <details><summary>External GL, adjustments and period close</summary>
        <ol>
          <li>Select the financial year, period, external source and currency. External GL mappings connect ledger codes to BrainBase’s accounts and dimensions using effective dates. A mapping does not import ledger entries; imports currently use an administrator API, not an automatic accounting connector or file-upload screen.</li>
          <li>Inspect source Actual and any finance adjustments separately. Use adjustment review to inspect lines, reasons and history before taking an available action.</li>
          <li>Prepare and inspect a reconciliation snapshot. Review the totals and unresolved items. Compare saved versions using comparison minus baseline; a header comparison does not compare every individual item.</li>
          <li>Complete the available review and period-close checks. Sign-off requires the appropriate reviewed evidence and current period close. Reopening or later changes may make earlier evidence noncurrent; read its status and history.</li>
          <li>Download the relevant evidence. Keep the original records and reversals distinct, and check which version and scope the report describes.</li>
        </ol>
        {budgetingAdmin ? <div className={styles.topics}><Link href="/commercial/budgeting/finance-controls">Open Finance Controls</Link><Link href="/commercial/budgeting/external-gl">Open External GL Mappings</Link></div> : null}
      </details>
    </section>

    <section id="need-help" className={styles.section} aria-labelledby="need-help-title">
      <h2 id="need-help-title">When something is blocked</h2>
      <ul>
        <li><strong>A screen or action is missing:</strong> check the selected organisation, enabled features and your role with your administrator. This guide does not grant access.</li>
        <li><strong>A budget will not activate:</strong> read its validation messages, check active accounts and cost centres, and make sure period allocations equal the annual amounts.</li>
        <li><strong>A save result is uncertain:</strong> follow the screen’s reload or recovery instruction and inspect the saved state before trying again.</li>
        <li><strong>A report looks empty:</strong> check the year, period, source, currency and filters. Empty evidence does not automatically mean no money is owed or all controls are complete.</li>
        <li><strong>A download does not appear:</strong> check your browser’s downloads list and download permissions, then retry the read or download shown on the screen.</li>
      </ul>
    </section>
  </article>;
}
