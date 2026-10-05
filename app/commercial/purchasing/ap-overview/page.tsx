'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import { AP_AGING_BUCKETS, type PagedSupplierApOverview } from '@/lib/commercial/supplierApOverviewModel';
import { PageHeader, StateMessage, Field, TableContainer, TableStateRow, buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';

const bucketLabels = { CURRENT: 'Not yet overdue', DAYS_1_30: '1–30 days overdue', DAYS_31_60: '31–60 days overdue',
  DAYS_61_90: '61–90 days overdue', DAYS_91_PLUS: '91+ days overdue', NO_DUE_DATE: 'No due date' };
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export default function SupplierApOverviewPage() {
  const [agingDate, setAgingDate] = useState('');
  const [report, setReport] = useState<{ key: string; data: PagedSupplierApOverview } | null>(null);
  const [options, setOptions] = useState<PagedSupplierApOverview['options']>({ currencies: [], suppliers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [currency, setCurrency] = useState('ALL');
  const [supplier, setSupplier] = useState('ALL');
  const [bucket, setBucket] = useState('ALL');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [supplierPage, setSupplierPage] = useState(1);
  const requestKey = JSON.stringify({ aging_date: agingDate, search: appliedSearch, currency: currency === 'ALL' ? '' : currency,
    supplier_id: supplier === 'ALL' ? '' : supplier, bucket: bucket === 'ALL' ? '' : bucket, page, supplier_page: supplierPage });
  function resetPages() { setPage(1); setSupplierPage(1); }
  // Resolve browser-local today after hydration; the server timezone must not choose the aging day.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAgingDate(today()); }, []);
  useEffect(() => {
    if (appliedSearch === search.trim()) return;
    const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(1); setSupplierPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const query = JSON.parse(requestKey) as Record<string, string | number>;
      if (!query.aging_date) return;
      setLoading(true); setReport(null); setError('');
      try {
        const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
        const res = await fetch(`/api/commercial/purchasing/ap-overview?${params}`, { signal: controller.signal, cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(res.status === 403 ? 'You do not have access to the supplier AP overview.' : data.error ?? 'Unable to load supplier AP overview.');
        if (!controller.signal.aborted) { setReport({ key: requestKey, data: data.report }); setOptions(data.report.options); }
      } catch (err) {
        if (!controller.signal.aborted) { setOptions({ currencies: [], suppliers: [] }); setError(err instanceof Error ? err.message : 'Unable to load supplier AP overview.'); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [requestKey]);
  const filtered = report?.key === requestKey && appliedSearch === search.trim() ? report.data : null;
  function pager(kind: 'bill' | 'supplier', current: number, count: number) {
    return <nav aria-label={`${kind} pages`} style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0' }}>
      <button type="button" aria-label={`Previous ${kind} page`} disabled={loading || current <= 1} onClick={() => kind === 'bill' ? setPage(current - 1) : setSupplierPage(current - 1)} {...buttonProps('secondary')}>Previous</button>
      <span>Page {current} · {count} matching {kind === 'bill' ? 'outstanding bills' : 'supplier/currency rows'}</span>
      <button type="button" aria-label={`Next ${kind} page`} disabled={loading || current * (filtered?.pagination.page_size ?? 50) >= count} onClick={() => kind === 'bill' ? setPage(current + 1) : setSupplierPage(current + 1)} {...buttonProps('secondary')}>Next</button>
    </nav>;
  }
  return <div style={{ maxWidth: 1400 }}>
    <PageHeader title="Supplier AP Overview" description="Current posted liabilities and supplier settlement. Separate from Budget Actual." />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      <Field label="Aging date">{control => <input {...control} type="date" className={fieldControlClassName} value={agingDate} onChange={event => { setAgingDate(event.target.value); resetPages(); }} />}</Field>
      <Field label="Search suppliers or bills">{control => <input {...control} className={fieldControlClassName} value={search} maxLength={200} onChange={event => setSearch(event.target.value)} />}</Field>
      <Field label="Currency">{control => <select {...control} className={fieldControlClassName} value={currency} onChange={event => { setCurrency(event.target.value); resetPages(); }}><option value="ALL">All currencies</option>{options.currencies.map(row => <option key={row}>{row}</option>)}</select>}</Field>
      <Field label="Supplier">{control => <select {...control} className={fieldControlClassName} value={supplier} onChange={event => { setSupplier(event.target.value); resetPages(); }}><option value="ALL">All suppliers</option>{options.suppliers.map(row => <option key={row.supplier_id} value={row.supplier_id}>{row.supplier_name}</option>)}</select>}</Field>
      <Field label="Aging bucket">{control => <select {...control} className={fieldControlClassName} value={bucket} onChange={event => { setBucket(event.target.value); resetPages(); }}><option value="ALL">All buckets</option>{AP_AGING_BUCKETS.map(key => <option key={key} value={key}>{bucketLabels[key]}</option>)}</select>}</Field>
    </div>
    {error && <StateMessage kind="error" title="AP overview unavailable">{error}</StateMessage>}
    {!error && (!filtered || loading) && <StateMessage kind="loading" title="Loading supplier AP overview…" />}
    {filtered && !loading && !error && <>
      <p>Current outstanding balances aged at {formatCommercialDate(filtered.aging_date)}. Totals include all matching bills across every page. This is not a historical balance report.</p>
      <h2>Totals by currency</h2>
      <TableContainer label="AP currency totals" minWidth={650}><table className={tableStyles.table}>
        <thead><tr><th scope="col">Currency</th><th scope="col">Posted payable</th><th scope="col">Paid against posted bills</th><th scope="col">Outstanding</th><th scope="col">Overdue</th></tr></thead>
        <tbody>{filtered.currencies.map(row => <tr key={row.currency}><td>{row.currency}</td>{[row.payable_cents, row.paid_cents, row.outstanding_cents, row.overdue_cents].map((amount, index) => <td key={index}>{formatMoneyCentsExact(amount, row.currency)}</td>)}</tr>)}{!filtered.currencies.length && <TableStateRow colSpan={5} kind="empty">No posted bills match these filters.</TableStateRow>}</tbody>
      </table></TableContainer>
      <h2>Supplier aging</h2>
      <TableContainer label="Supplier AP aging" minWidth={1100}><table className={tableStyles.table}>
        <thead><tr><th scope="col">Supplier</th><th scope="col">Currency</th><th scope="col">Outstanding</th>{AP_AGING_BUCKETS.map(key => <th scope="col" key={key}>{bucketLabels[key]}</th>)}</tr></thead>
        <tbody>{filtered.suppliers.map(row => <tr key={`${row.supplier_id}:${row.currency}`}><td><Link href={`/commercial/purchasing/suppliers/${row.supplier_id}`}>{row.supplier_name}</Link>{!row.supplier_active && ' (Inactive)'}</td><td>{row.currency}</td><td>{formatMoneyCentsExact(row.outstanding_cents, row.currency)}</td>{AP_AGING_BUCKETS.map(key => <td key={key}>{formatMoneyCentsExact(row.buckets[key], row.currency)}</td>)}</tr>)}{!filtered.suppliers.length && <TableStateRow colSpan={9} kind="empty">No supplier balances on this page.</TableStateRow>}</tbody>
      </table></TableContainer>
      {pager('supplier', supplierPage, filtered.pagination.supplier_count)}
      <h2>Outstanding bills</h2>
      <TableContainer label="Outstanding supplier bills" minWidth={850}><table className={tableStyles.table}>
        <thead><tr><th scope="col">Bill</th><th scope="col">Supplier</th><th scope="col">Due date</th><th scope="col">Currency</th><th scope="col">Outstanding</th><th scope="col">Aging</th></tr></thead>
        <tbody>{filtered.bills.map(row => <tr key={row.bill_id}><td><Link href={`/commercial/purchasing/supplier-bills/${row.bill_id}`}>{row.bill_number ?? row.supplier_invoice_number}</Link></td><td>{row.supplier_name}</td><td>{row.due_date ? formatCommercialDate(row.due_date) : 'No due date'}</td><td>{row.currency}</td><td>{formatMoneyCentsExact(row.outstanding_cents, row.currency)}</td><td>{bucketLabels[row.bucket]}</td></tr>)}{!filtered.bills.length && <TableStateRow colSpan={6} kind="empty">No outstanding bills on this page.</TableStateRow>}</tbody>
      </table></TableContainer>
      {pager('bill', page, filtered.pagination.outstanding_bill_count)}
    </>}
  </div>;
}
