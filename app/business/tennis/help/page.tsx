import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tennisBusinessAccess } from '@/lib/tennisBusiness/access';
export default async function TennisBusinessHelp() {
  const access = await tennisBusinessAccess();
  if (!access.ok) {
    if (access.status === 401) redirect('/login');
    return <main style={{ padding: 24 }}><h1>Workspace help unavailable</h1><p>Ask your organisation administrator to check your access.</p></main>;
  }
  return <main style={{ maxWidth: 900, padding: 24, margin: '0 auto', lineHeight: 1.7 }}>
    <p><Link href="/business/tennis">Back to the business workspace</Link></p><h1>Run LD Tennis with Brainbase</h1>
    <h2>Set up once</h2><ol><li>Confirm the administrator, staff roles and module access. Coaches need only the areas used in their work.</li><li>Review the current Squad and CRM contacts. Do not bulk-copy players or match people automatically by a shared email.</li><li>Confirm who pays: a player, parent, family or business. Select that person’s CRM contact when creating the Commercial billing customer.</li><li>Confirm currency, tax codes, lesson products and invoice terms before issuing an invoice. Existing records do not change when a module is enabled.</li></ol>
    <h2>Coaching and attendance</h2><p>The staff coaching timetable in this business workspace uses the existing Tennis sessions and bookings. The old Sessions address remains available. Creating, changing or cancelling a session affects those same records; there is no second booking list to maintain.</p><p>Scheduling availability and resource planning are separate from this compatibility timetable. A location label on an existing Tennis session is not a reserved Scheduling resource. Full migration to the new booking engine needs its own capacity, availability and history checks before cutover.</p>
    <h2>From enquiry to payment</h2><ol><li>Record the player and parent enquiry in CRM and add a follow-up activity.</li><li>Review the existing Squad record and enrol the player in the coaching timetable. Confirm whether it is a one-off or weekly booking.</li><li>Mark attendance after the lesson. Review cancellations and pauses before billing.</li><li>Select or create the billing customer, link their CRM contact, then create a draft invoice with the correct lesson, date, quantity and price.</li><li>Review and issue the invoice. Record an incoming payment only once received, against that invoice. A paid tick in Tennis does not create, settle or reconcile an invoice.</li></ol>
    <h2>Expenses</h2><p>Use Purchasing’s existing supplier → purchase order → receipt → supplier bill workflow. Record the supplier payment against the bill. The workspace shows posted bills by bill date and recorded supplier payments by payment date; it does not treat either as a complete expense ledger.</p>
    <h2>Read the business figures</h2><p>Choose a financial month. Invoiced amounts are issued invoices dated in that month; customer payments are currently recorded payments received in that month. Outstanding is the remaining amount on all issued invoices, including earlier months. Draft and void invoices, cancelled bills and reversed payments do not count. Currencies are never added together. These are saved business records, not bank-confirmed balances or a profit/tax return.</p>
    <h2>When a change is uncertain</h2><p>Do not click again if the result was lost. Use the review action and inspect saved records first. A failed read is not an empty business. Contact an administrator if access changed. Never recreate a paid invoice or payment just because a screen failed to load.</p>
  </main>;
}
