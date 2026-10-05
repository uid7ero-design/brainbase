'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { AP_AGING_BUCKETS, buildSupplierApOverview, type SupplierApOverview } from '@/lib/commercial/supplierApOverviewModel';
import { PageHeader, StateMessage, Field, TableContainer, TableStateRow, fieldControlClassName, tableStyles } from '@/components/ui/app';

const bucketLabels = { CURRENT: 'Not yet overdue', DAYS_1_30: '1–30 days overdue', DAYS_31_60: '31–60 days overdue',
  DAYS_61_90: '61–90 days overdue', DAYS_91_PLUS: '91+ days overdue', NO_DUE_DATE: 'No due date' };
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export default function SupplierApOverviewPage() {
  const [agingDate, setAgingDate] = useState('');
  const [report, setReport] = useState<SupplierApOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('ALL');
  const [supplier, setSupplier] = useState('ALL');
  const [bucket, setBucket] = useState('ALL');
  // Resolve browser-local today after hydration; the server timezone must not choose the aging day.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAgingDate(today()); }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setReport(null); setError('');
      try {
        const res = await fetch(`/api/commercial/purchasing/ap-overview?aging_date=${encodeURIComponent(agingDate)}`, { signal: controller.signal, cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(res.status === 403 ? 'You do not have access to the supplier AP overview.' : data.error ?? 'Unable to load supplier AP overview.');
        if (!controller.signal.aborted) setReport(data.report);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load supplier AP overview.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [agingDate]);
  const visibleReport = report && report.aging_date === agingDate ? report : null;
  const filtered = visibleReport ? buildSupplierApOverview(visibleReport.bills.filter(bill =>
    (currency === 'ALL' || bill.currency === currency) && (supplier === 'ALL' || bill.supplier_id === supplier) &&
    (bucket === 'ALL' || bill.bucket === bucket) &&
    `${bill.supplier_name} ${bill.bill_number ?? ''} ${bill.supplier_invoice_number}`.toLowerCase().includes(search.toLowerCase())), agingDate) : null;
  const supplierOptions = [...new Map(visibleReport?.suppliers.map(row => [row.supplier_id, row.supplier_name])).entries()];
  return <div style={{ maxWidth: 1400 }}>
    <PageHeader title="Supplier AP Overview" description="Current posted liabilities and supplier settlement. Separate from Budget Actual." />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      <Field label="Aging date">{control => <input {...control} type="date" className={fieldControlClassName} value={agingDate} onChange={event => setAgingDate(event.target.value)} />}</Field>
      <Field label="Search suppliers or bills">{control => <input {...control} className={fieldControlClassName} value={search} onChange={event => setSearch(event.target.value)} />}</Field>
      <Field label="Currency">{control => <select {...control} className={fieldControlClassName} value={currency} onChange={event => setCurrency(event.target.value)}><option value="ALL">All currencies</option>{visibleReport?.currencies.map(row => <option key={row.currency}>{row.currency}</option>)}</select>}</Field>
      <Field label="Supplier">{control => <select {...control} className={fieldControlClassName} value={supplier} onChange={event => setSupplier(event.target.value)}><option value="ALL">All suppliers</option>{supplierOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}</Field>
      <Field label="Aging bucket">{control => <select {...control} className={fieldControlClassName} value={bucket} onChange={event => setBucket(event.target.value)}><option value="ALL">All buckets</option>{AP_AGING_BUCKETS.map(key => <option key={key} value={key}>{bucketLabels[key]}</option>)}</select>}</Field>
    </div>
    {error && <StateMessage kind="error" title="AP overview unavailable">{error}</StateMessage>}
    {!error && (!filtered || loading) && <StateMessage kind="loading" title="Loading supplier AP overview…" />}
    {filtered && !loading && !error && <>
      <p>Current outstanding balances aged at {formatCommercialDate(filtered.aging_date)}. Totals reflect the filters above. This is not a historical balance report.</p>
      <h2>Totals by currency</h2>
      <TableContainer label="AP currency totals" minWidth={650}><table className={tableStyles.table}>
        <thead><tr><th scope="col">Currency</th><th scope="col">Posted payable</th><th scope="col">Paid against posted bills</th><th scope="col">Outstanding</th><th scope="col">Overdue</th></tr></thead>
        <tbody>{filtered.currencies.map(row => <tr key={row.currency}><td>{row.currency}</td>{[row.payable_cents, row.paid_cents, row.outstanding_cents, row.overdue_cents].map((amount, index) => <td key={index}>{formatMoneyCentsExact(amount, row.currency)}</td>)}</tr>)}{!filtered.currencies.length && <TableStateRow colSpan={5} kind="empty">No posted bills match these filters.</TableStateRow>}</tbody>
      </table></TableContainer>
      <h2>Supplier aging</h2>
      <TableContainer label="Supplier AP aging" minWidth={1100}><table className={tableStyles.table}>
        <thead><tr><th scope="col">Supplier</th><th scope="col">Currency</th><th scope="col">Outstanding</th>{AP_AGING_BUCKETS.map(key => <th scope="col" key={key}>{bucketLabels[key]}</th>)}</tr></thead>
        <tbody>{filtered.suppliers.map(row => <tr key={`${row.supplier_id}:${row.currency}`}><td><Link href={`/commercial/purchasing/suppliers/${row.supplier_id}`}>{row.supplier_name}</Link>{!row.supplier_active && ' (Inactive)'}</td><td>{row.currency}</td><td>{formatMoneyCentsExact(row.outstanding_cents, row.currency)}</td>{AP_AGING_BUCKETS.map(key => <td key={key}>{formatMoneyCentsExact(row.buckets[key], row.currency)}</td>)}</tr>)}{!filtered.suppliers.length && <TableStateRow colSpan={9} kind="empty">No supplier balances match these filters.</TableStateRow>}</tbody>
      </table></TableContainer>
      <h2>Outstanding bills</h2>
      <TableContainer label="Outstanding supplier bills" minWidth={850}><table className={tableStyles.table}>
        <thead><tr><th scope="col">Bill</th><th scope="col">Supplier</th><th scope="col">Due date</th><th scope="col">Currency</th><th scope="col">Outstanding</th><th scope="col">Aging</th></tr></thead>
        <tbody>{filtered.bills.filter(row => BigInt(row.outstanding_cents) > BigInt(0)).map(row => <tr key={row.bill_id}><td><Link href={`/commercial/purchasing/supplier-bills/${row.bill_id}`}>{row.bill_number ?? row.supplier_invoice_number}</Link></td><td>{row.supplier_name}</td><td>{row.due_date ? formatCommercialDate(row.due_date) : 'No due date'}</td><td>{row.currency}</td><td>{formatMoneyCentsExact(row.outstanding_cents, row.currency)}</td><td>{bucketLabels[row.bucket]}</td></tr>)}{!filtered.bills.some(row => BigInt(row.outstanding_cents) > BigInt(0)) && <TableStateRow colSpan={6} kind="empty">No outstanding bills match these filters.</TableStateRow>}</tbody>
      </table></TableContainer>
    </>}
  </div>;
}
