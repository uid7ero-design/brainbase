import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/app';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import sql from '@/lib/db';
import { businessPeriod, currentBusinessMonth } from '@/lib/tennisBusiness/model';
import { financePaths, type FinanceWorkspace } from '@/lib/commercial/financeWorkspace';
import { financeRegisterAccess } from '@/lib/commercial/financeRegisterAccess';
import { receiptIdPattern, receiptToday } from '@/lib/tennisBusiness/receiptInput';
import ReceiptForm, { StartReceipt } from './ReceiptForm';
import styles from '@/app/business/tennis/business.module.css';

export type ReceiptPageProps = { searchParams: Promise<{ month?: string; entry?: string }> };
type Receipt = { id: string; date: string; merchant: string; description: string; receipt_reference: string | null; amount_cents: number };

function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  return <div><strong>{receipt.merchant} · {formatMoneyCentsExact(String(receipt.amount_cents), 'AUD')}</strong>
    <p>{receipt.description} · {formatCommercialDate(receipt.date)}{receipt.receipt_reference && ' · Receipt ' + receipt.receipt_reference}</p></div>;
}

export default async function ReceiptExpenses({ searchParams, workspace }: ReceiptPageProps & { workspace: FinanceWorkspace }) {
  const Container = workspace === 'commercial' ? 'section' : 'main';
  const paths = financePaths[workspace];
  const path = paths.expenses;
  const access = await financeRegisterAccess(workspace, 'purchasing');
  if (!access.ok && access.status === 401) redirect('/login');
  if (!access.ok) return <Container><h1>Receipt expenses unavailable</h1><p>Check your organisation and Purchasing access.</p></Container>;
  const { month = currentBusinessMonth(), entry } = await searchParams;
  if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
      (entry !== undefined && (typeof entry !== 'string' || !receiptIdPattern.test(entry)))) {
    return <Container><h1>Invalid receipt view</h1><Link href={path}>Open receipt expenses</Link></Container>;
  }
  const { organisationId } = access.session;
  const { from, to } = businessPeriod(month);
  let rows: Receipt[];
  try {
    rows = (entry
      ? await sql`SELECT id, purchase_date::text AS date, merchant, description, receipt_reference, amount_cents
          FROM tennis_receipt_expenses WHERE organisation_id=${organisationId} AND id=${entry}`
      : await sql`SELECT id, purchase_date::text AS date, merchant, description, receipt_reference, amount_cents
          FROM tennis_receipt_expenses WHERE organisation_id=${organisationId} AND purchase_date>=${from} AND purchase_date<${to}
          ORDER BY purchase_date DESC, recorded_at DESC, id`) as Receipt[];
  } catch {
    return <Container><h1>Receipt expenses unavailable</h1><p role="alert">Saved receipts could not be loaded. Refresh this page to retry.</p></Container>;
  }
  return <Container className={styles.page}>
    <PageHeader title={entry ? (rows.length ? 'Saved receipt' : 'Record a paid expense') : 'Receipt expenses'} />
    {entry ? <>
      {rows.length ? <ReceiptDetails receipt={rows[0]} /> : access.canRecord ? <>
        <p>Use the total paid on the receipt. Check existing purchases first to avoid recording a supplier bill twice.</p>
        <ReceiptForm api={paths.expenseApi} organisationId={organisationId} id={entry} today={receiptToday()} />
      </> : <p>Recording purchases requires Purchasing write access and an administrator role.</p>}
      <Link href={path + '?month=' + (rows[0]?.date.slice(0, 7) ?? month)}>View receipt expenses</Link>
    </> : <>
      <form className={styles.toolbar} method="get"><label>Purchase month <input type="month" name="month" min="2000-01" max="2099-12" defaultValue={month} required /></label><button>Show receipts</button></form>
      <p>Receipt spending (AUD) · {formatMoneyCentsExact(rows.reduce((sum, row) => sum + BigInt(row.amount_cents), BigInt(0)), 'AUD')}</p>
      {access.canRecord && <StartReceipt path={path} month={month} />}
      {rows.length ? <ul>{rows.map(row => <li key={row.id}><ReceiptDetails receipt={row} /></li>)}</ul> : <p>No receipts recorded for this month.</p>}
    </>}
    <Link href={paths.back}>{paths.backLabel}</Link>
  </Container>;
}
