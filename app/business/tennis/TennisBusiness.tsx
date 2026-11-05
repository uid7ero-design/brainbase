'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, PageHeader, Panel } from '@/components/ui/app';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { currentBusinessMonth, type BusinessOverview, type Section } from '@/lib/tennisBusiness/model';
import styles from './business.module.css';

function SavedSection<T>({ section, children }: { section: Section<T>; children: (value: T) => React.ReactNode }) {
  if (section.state === 'not_enabled') return <p>This area is not available to your account.</p>;
  if (section.state === 'unavailable') return <p role="alert">Saved figures could not be loaded. Refresh before making a decision.</p>;
  return children(section.value);
}
export default function TennisBusiness({ financeOnly = false }: { financeOnly?: boolean }) {
  const [month, setMonth] = useState(currentBusinessMonth);
  const [revision, setRevision] = useState(0);
  const key = month + ':' + revision;
  const [result, setResult] = useState<{ key: string; data?: BusinessOverview; error?: string }>({ key: '' });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/business/tennis?month=' + encodeURIComponent(month), { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load the business workspace. Your access may have changed.');
        const data = await response.json() as BusinessOverview;
        if (data.month !== month || !Array.isArray(data.modules) || !data.coaching || !data.crm || !data.income || !data.costs) throw new Error('Saved figures could not be confirmed.');
        if (active) setResult({ key, data });
      } catch (error) { if (active) setResult({ key, error: error instanceof Error ? error.message : 'Workspace unavailable.' }); }
    })();
    return () => { active = false; controller.abort(); };
  }, [key, month]);
  const current = result.key === key ? result : undefined;
  const loaded = current?.data;
  const financeDenied = financeOnly && loaded && !loaded.modules.some(key => key === 'invoicing' || key === 'purchasing');
  const data = financeDenied ? undefined : loaded;
  const refresh = () => setRevision(value => value + 1);
  return <div className={styles.page}>
    <PageHeader title={financeOnly ? "LD Tennis finances" : "LD Tennis business"} description={financeOnly ? "Invoice lessons, review money received and keep supplier costs in order." : "Coaching, players and business records in one place."} actions={<Button onClick={refresh}>Refresh saved figures</Button>} />
    {(financeOnly || data?.modules.some(key => key === 'invoicing' || key === 'purchasing')) && <p><Link href={financeOnly ? '/business/tennis' : '/business/tennis/finance'}>{financeOnly ? 'Back to the business workspace' : 'Open invoicing, revenue and expenses'}</Link></p>}
    <div className={styles.toolbar}><label>Financial month <input aria-label="Financial month" type="month" min="2000-01" max="2099-12" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /></label><span>Australia/Adelaide · financial figures are separated by currency</span></div>
    {!current && <p role="status">Loading saved business figures…</p>}
    {financeDenied && <p role="alert">Invoicing or Purchasing access is no longer available. Ask your administrator to check your access.</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {data && <>
      <div className={styles.grid}>
        {!financeOnly && <Panel title="Coaching today"><SavedSection section={data.coaching}>{value => <><p>{value.sessions} scheduled sessions today · {value.players} active Squad players</p><p>Today: {value.today}</p><Link href="/business/tennis/coaching">Open coaching timetable, bookings and attendance</Link><p><Link href="/scheduling">Manage Scheduling availability and resources</Link></p></>}</SavedSection></Panel>}
        {!financeOnly && <Panel title="Players and enquiries"><SavedSection section={data.crm}>{value => <><p>{value.contacts} CRM contacts · {value.openDeals} open opportunities</p><p><Link href="/crm/contacts">Open CRM contacts</Link></p><p><Link href="/crm/activities">Record a follow-up</Link></p><p>Keep the player and their parent or billing contact distinct, even when they share an email address.</p></>}</SavedSection></Panel>}
        <Panel title="Customer invoices and payments"><SavedSection section={data.income}>{rows => <>
          {rows.length === 0 ? <p>No issued invoices or recorded payments are available for this view.</p> : rows.map(row => <div key={row.currency} className={styles.figures}><h3>{row.currency}</h3><dl><dt>Invoiced this month</dt><dd>{formatMoneyCentsExact(row.invoiced_cents, row.currency)}</dd><dt>Payments recorded this month</dt><dd>{formatMoneyCentsExact(row.received_cents, row.currency)}</dd><dt>Outstanding across all issued invoices</dt><dd>{formatMoneyCentsExact(row.outstanding_cents, row.currency)}</dd></dl></div>)}
          <p><Link href="/commercial/invoices/new">Create a lesson invoice</Link> · <Link href="/commercial/invoices?status=DRAFT">Continue draft invoices</Link></p>
          <p><Link href="/commercial/customers">Manage billing customers</Link> · <Link href="/commercial/products">Lesson prices and services</Link></p><p><Link href="/commercial/invoices">Open invoices and record a payment</Link></p>
        </>}</SavedSection></Panel>
        <Panel title="Supplier bills and spending"><SavedSection section={data.costs}>{rows => <>
          {rows.length === 0 ? <p>No posted supplier bills or recorded supplier payments in this month.</p> : rows.map(row => <div key={row.currency} className={styles.figures}><h3>{row.currency}</h3><dl><dt>Supplier bills dated this month</dt><dd>{formatMoneyCentsExact(row.billed_cents, row.currency)}</dd><dt>Supplier payments recorded this month</dt><dd>{formatMoneyCentsExact(row.paid_cents, row.currency)}</dd></dl></div>)}
          <p><Link href="/commercial/purchasing/purchase-orders">Plan a purchase</Link> · <Link href="/commercial/purchasing/purchase-receipts">Record goods or services received</Link></p>
          <p><Link href="/commercial/purchasing/supplier-bills/new">Enter a supplier bill</Link> · <Link href="/commercial/purchasing/ap-overview">Review unpaid supplier bills</Link></p>
          <p>Expenses use supplier → purchase order → receipt → bill → payment. Court hire and coaching equipment can be described as service or goods lines. A draft order is not an expense or payment.</p><p><Link href="/commercial/purchasing/supplier-bills">Open supplier bills</Link></p>
        </>}</SavedSection></Panel>
      </div>
      {financeOnly && <Panel title="Your weekly finance routine">
        <ol><li><Link href="/scheduling/coaching">Review lessons and attendance</Link>, then choose “Review for invoicing” on the booking. Confirm the paying parent or customer and the agreed charge.</li><li>Check existing invoices before creating another. Add lesson dates, quantities and the agreed price; review tax and due date before issuing. Issuing and sending are separate actions.</li><li>Open each issued invoice to record money actually received. Record partial payments accurately; do not repeat a payment when its response is lost.</li><li>Enter supplier bills against the order and receipt. Post the checked bill, then record the supplier payment only when paid.</li><li>Compare this month’s received and paid amounts with your bank records. Check older unpaid customer invoices and supplier bills separately.</li></ol>
        <p><Link href="/commercial/settings">Review business details and invoice settings</Link> · <Link href="/business/tennis/help">Step-by-step finance guide</Link></p>
        <p>Choose tax codes explicitly from your existing setup. This workspace does not assume GST registration, infer a payer from a player’s email, move money or send invoices automatically.</p>
      </Panel>}
      <Panel title={financeOnly ? "About these figures" : "Run the business"}>
        {!financeOnly && <ol><li>Review the player or parent in CRM before adding another contact.</li><li>Use the coaching timetable for existing sessions, enrolments and attendance.</li><li>Create or select the billing customer, link their CRM contact and prepare the lesson invoice.</li><li>Issue the checked invoice, then record the payment when it has actually been received.</li><li>Record purchases, receipts and supplier bills before recording their payments.</li></ol>}
        <p>Recorded payments do not move money or prove a bank settlement. A Tennis paid tick is not automatically a Commercial payment. These figures are not a profit, tax or bank-reconciliation report.</p>
        {data.modules.includes('budgeting') && <p><Link href="/commercial/budgeting/finance-controls">Open budgets and finance controls</Link></p>}
        <p><Link href="/business/tennis/help">Workspace help and setup checklist</Link></p>
      </Panel>
    </>}
  </div>;
}
