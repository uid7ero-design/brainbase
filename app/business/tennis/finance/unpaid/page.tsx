import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader, TableContainer, tableStyles } from '@/components/ui/app';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import sql from '@/lib/db';
import { tennisBusinessAccess } from '@/lib/tennisBusiness/access';
import styles from '../../business.module.css';

type Balance = {
  id: string;
  invoice_number: string | null;
  payer: string | null;
  currency: string;
  due_date: string | null;
  overdue: boolean | null;
  total: string;
  paid: string;
  remaining: string;
};

async function unpaidInvoices(organisationId: string) {
  return await sql`
    WITH allocated AS (
      SELECT a.invoice_id, SUM(a.allocated_amount_cents) AS paid
      FROM commercial_payment_allocations a
      JOIN commercial_payments p ON p.id = a.payment_id AND p.organisation_id = a.organisation_id
      WHERE a.organisation_id = ${organisationId} AND p.status = 'RECORDED'
      GROUP BY a.invoice_id
    )
    SELECT i.id, i.invoice_number, i.customer_name_snapshot AS payer, i.currency,
      to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
      i.due_date < (now() AT TIME ZONE 'Australia/Adelaide')::date AS overdue,
      i.total_cents::text AS total, COALESCE(a.paid, 0)::text AS paid,
      (i.total_cents - COALESCE(a.paid, 0))::text AS remaining
    FROM commercial_invoices i
    LEFT JOIN allocated a ON a.invoice_id = i.id
    WHERE i.organisation_id = ${organisationId} AND i.status = 'ISSUED'
      AND i.total_cents > COALESCE(a.paid, 0)
    ORDER BY i.due_date ASC NULLS LAST, i.invoice_number, i.id
  ` as Balance[];
}

export default async function UnpaidInvoicesPage() {
  const access = await tennisBusinessAccess();
  if (!access.ok && access.status === 401) redirect('/login');
  if (!access.ok || !access.modules.includes('invoicing')) {
    return <main><h1>Customer balances unavailable</h1><p>Check your organisation and invoicing access.</p></main>;
  }
  const invoices = await unpaidInvoices(access.session.organisationId).catch(() => null);
  return <main className={styles.page} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
    <PageHeader title="Unpaid customer invoices" description="Issued invoices with a balance remaining, across all months. Earliest due dates appear first." />
    <Link href="/business/tennis/finance">Back to LD Tennis finances</Link>
    {invoices === null ? <div><p role="alert">Customer balances could not be loaded.</p><form action="/business/tennis/finance/unpaid" method="get"><button type="submit">Retry balances</button></form></div>
      : invoices.length === 0 ? <p>No unpaid customer invoices.</p>
      : <TableContainer label="Unpaid customer invoices" minWidth={720}>
        <table className={tableStyles.table}>
          <thead><tr>{['Invoice', 'Billing customer', 'Due date', 'Currency', 'Invoiced', 'Received', 'Remaining'].map(label =>
            <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{invoices.map(invoice => <tr key={invoice.id}>
            <td><Link href={`/commercial/invoices/${invoice.id}`}>{invoice.invoice_number ?? 'Open invoice'}</Link></td>
            <td>{invoice.payer ?? 'Customer name unavailable'}</td>
            <td>{invoice.due_date ? formatCommercialDate(invoice.due_date) : 'No due date'}{invoice.overdue && ' · Overdue'}</td>
            <td>{invoice.currency}</td>
            <td className={tableStyles.num}>{formatMoneyCentsExact(invoice.total, invoice.currency)}</td>
            <td className={tableStyles.num}>{formatMoneyCentsExact(invoice.paid, invoice.currency)}</td>
            <td className={tableStyles.num}>{formatMoneyCentsExact(invoice.remaining, invoice.currency)}</td>
          </tr>)}</tbody>
        </table>
      </TableContainer>}
  </main>;
}
