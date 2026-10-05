'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { paymentRequestKey, clearPaymentRequestKey } from '@/lib/commercial/paymentRequestKey';
import Link from 'next/link';
import { PAYMENT_METHODS } from '@/lib/commercial/paymentMethods';
import { parseRemittanceAmount, MAX_REMITTANCE_CENTS } from '@/lib/commercial/supplierRemittanceInput';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import type { ApBillInput } from '@/lib/commercial/supplierApOverviewModel';
import { PageHeader, StateMessage, Field, TableContainer, TableStateRow, buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';
type Candidate = ApBillInput & { outstanding_cents: string };
type Recorded = { payment: { id: string; amount_cents: number; currency: string; status: 'RECORDED' | 'REVERSED' }; allocations: Array<{ supplier_bill_id: string; allocated_amount_cents: number }>; billLabels: Record<string, string> };
export default function SupplierRemittancePage() {
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<{ name: string; active: boolean } | null>(null);
  const [bills, setBills] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [canPay, setCanPay] = useState(false);
  const [currency, setCurrency] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setBills([]); setSupplier(null); setCanPay(false);
    try {
      const [res, meRes] = await Promise.all([fetch(`/api/commercial/suppliers/${id}/payments`, { cache: 'no-store', signal }), fetch('/api/me', { signal })]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unable to load supplier bills.');
      const me = meRes.ok ? await meRes.json() : {};
      if (!signal?.aborted) {
        setSupplier(data.supplier); setBills(data.bills); setCanPay(['admin', 'super_admin'].includes(me.role));
      }
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Unable to load supplier bills.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [id]);
  // Follow the existing Commercial load-on-mount pattern, with abort cleanup.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const currencies = [...new Set(bills.map(bill => bill.currency))];
  const visible = bills.filter(bill => bill.currency === currency);
  let allocations: Array<{ supplier_bill_id: string; amount_cents: number }> = [];
  let total = 0;
  let validation = '';
  try {
    allocations = visible.filter(bill => (amounts[bill.bill_id] ?? '').trim()).map(bill => {
      const amount = parseRemittanceAmount(amounts[bill.bill_id]);
      if (BigInt(amount) > BigInt(bill.outstanding_cents)) throw new Error(`Allocation exceeds remaining balance for ${bill.bill_number ?? bill.supplier_invoice_number}.`);
      return { supplier_bill_id: bill.bill_id, amount_cents: amount };
    });
    total = allocations.reduce((sum, allocation) => sum + allocation.amount_cents, 0);
    if (total > MAX_REMITTANCE_CENTS || allocations.length > 100) throw new Error('Choose at most 100 bills within the supported payment amount.');
  } catch (err) { validation = err instanceof Error ? err.message : 'Invalid allocations.'; }
  async function record(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !canPay || validation || !total || !method) return;
    setBusy(true); setError(''); setRecorded(null);
    try {
      const payload = JSON.stringify({ currency, method, reference: reference || null,
        allocations: [...allocations].sort((a, b) => a.supplier_bill_id.localeCompare(b.supplier_bill_id)) });
      const key = await paymentRequestKey(`supplier:${id}`, payload);
      const res = await fetch(`/api/commercial/suppliers/${id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: payload });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unable to confirm payment. Check bill payment history before retrying.');
      clearPaymentRequestKey(`supplier:${id}`, key);
      setRecorded({ ...data, billLabels: Object.fromEntries(visible.map(bill => [bill.bill_id, bill.bill_number ?? bill.supplier_invoice_number])) }); setAmounts({}); setMethod(''); setReference('');
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to confirm payment.';
      setError(message.includes('history') ? message : `${message} Check bill payment history before retrying.`);
    }
    finally { setBusy(false); }
  }
  return <div style={{ maxWidth: 1100 }}>
    <PageHeader title="Supplier Remittance" eyebrow={<Link href={`/commercial/purchasing/suppliers/${id}`}>← Supplier</Link>} description={supplier ? `${supplier.name}${supplier.active ? '' : ' (Inactive)'}` : 'Allocate one payment across posted bills.'} />
    <p>One supplier and currency per remittance. The payment must be fully allocated. Reversal from any allocated bill reverses the entire remittance. Cash settlement remains separate from Budget Actual.</p>
    {recorded && <StateMessage kind="empty" title={`${recorded.payment.status === 'REVERSED' ? 'Payment already reversed' : 'Payment recorded'}: ${formatMoneyCentsExact(String(recorded.payment.amount_cents), recorded.payment.currency)}`}>
      {recorded.allocations.map(allocation => <span key={allocation.supplier_bill_id}><Link href={`/commercial/purchasing/supplier-bills/${allocation.supplier_bill_id}`}>View {recorded.billLabels[allocation.supplier_bill_id] ?? 'bill'} payment history</Link>{' '}</span>)}
    </StateMessage>}
    {error && <StateMessage kind="error" title="Remittance unavailable">{error}</StateMessage>}
    {loading && <StateMessage kind="loading" title="Loading outstanding bills…" />}
    {!loading && supplier && <>
      {!canPay && <StateMessage kind="empty" title="Payment recording requires Purchasing admin access." />}
      <form onSubmit={record}>
        <Field label="Currency">{control => <select {...control} className={fieldControlClassName} value={currency} disabled={busy} onChange={event => { setCurrency(event.target.value); setAmounts({}); }}><option value="">Select currency</option>{currencies.map(value => <option key={value}>{value}</option>)}</select>}</Field>
        <TableContainer label="Remittance allocations" minWidth={750}><table className={tableStyles.table}>
          <thead><tr><th scope="col">Bill</th><th scope="col">Due date</th><th scope="col">Remaining</th><th scope="col">Allocate</th></tr></thead>
          <tbody>{visible.map(bill => <tr key={bill.bill_id}><td><Link href={`/commercial/purchasing/supplier-bills/${bill.bill_id}`}>{bill.bill_number ?? bill.supplier_invoice_number}</Link></td><td>{bill.due_date ? formatCommercialDate(bill.due_date) : 'No due date'}</td><td>{formatMoneyCentsExact(bill.outstanding_cents, bill.currency)}</td><td><input aria-label={`Allocate ${bill.bill_number ?? bill.supplier_invoice_number}`} className={fieldControlClassName} inputMode="decimal" disabled={busy || !canPay} value={amounts[bill.bill_id] ?? ''} onChange={event => setAmounts(previous => ({ ...previous, [bill.bill_id]: event.target.value }))} /></td></tr>)}{!visible.length && <TableStateRow colSpan={4} kind="empty">{bills.length ? 'Choose a currency to allocate bills.' : 'No outstanding posted bills.'}</TableStateRow>}</tbody>
        </table></TableContainer>
        {validation && <StateMessage kind="error" title="Check allocations">{validation}</StateMessage>}
        <p>Remittance total: {currency ? formatMoneyCentsExact(String(total), currency) : 'Select currency'}</p>
        {canPay && <>
          <Field label="Payment method" required>{control => <select {...control} className={fieldControlClassName} value={method} disabled={busy} onChange={event => setMethod(event.target.value)}><option value="">Select method</option>{PAYMENT_METHODS.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select>}</Field>
          <Field label="Reference">{control => <input {...control} className={fieldControlClassName} value={reference} disabled={busy} onChange={event => setReference(event.target.value)} />}</Field>
          <button type="button" disabled={busy} onClick={() => { setAmounts({}); void load(); }} {...buttonProps('secondary')}>Refresh balances</button>{' '}
          <button type="submit" disabled={busy || loading || !!validation || !total || !method} {...buttonProps('primary')}>Record Remittance</button>
        </>}
      </form>
    </>}
  </div>;
}
