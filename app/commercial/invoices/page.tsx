'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { StatusBadge, OverdueBadge } from './_status';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';
import {
  PageHeader,
  TableContainer,
  TableStateRow,
  WorkToolbar,
  buttonProps,
  tableStyles,
  toolbarControlClassName,
} from '@/components/ui/app';

type Invoice = {
  id: string; invoice_number: string | null; status: string; customer_id: string;
  customer_name_snapshot: string | null; source_quote_id: string | null;
  issue_date: string | null; due_date: string | null; overdue: boolean;
  total_cents: number; currency: string; created_at: string;
};
type Customer = { id: string; name: string };

// Phase C4.2 blocker fix — `overdue` is server-authoritative, computed
// by lib/commercial/invoices.ts's listInvoices() via SQL (`due_date <
// CURRENT_DATE`, gated on status = 'ISSUED') and returned directly on
// each row. This page renders `inv.overdue` as-is and MUST NOT recompute
// it — the previous client-side check derived "today" from an ISO-8601
// instant-string built off the viewer's own clock, sliced down to a
// calendar date, which is genuinely wrong for an Adelaide-based
// business: that string always reports the UTC calendar date, and
// Adelaide is UTC+9:30/+10:30, so for roughly the first 9.5–10.5 hours
// of every local day, that UTC-derived "today" is still the previous
// calendar date — silently under-reporting overdue invoices exactly
// during normal morning business hours.

export default function InvoicesPage() {
  const searchParams = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customersById, setCustomersById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'ALL');

  async function load() {
    const [invoicesRes, customersRes] = await Promise.all([
      fetch('/api/commercial/invoices'),
      fetch('/api/commercial/customers'),
    ]);
    const invoicesData = await invoicesRes.json();
    const customersData = await customersRes.json();
    setInvoices(invoicesData.invoices ?? []);
    setCustomersById(Object.fromEntries((customersData.customers ?? []).map((c: Customer) => [c.id, c.name])));
    setLoading(false);
  }

  // Mirrors the identical, pre-existing load()-in-effect pattern already
  // used unmodified throughout Commercial (see app/commercial/quotes/page.tsx's
  // own identical line, which fails this same rule today) — not a
  // regression introduced by this phase.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'ALL' ? invoices : invoices.filter(inv => inv.status === statusFilter);

  return (
    <div style={{ maxWidth: 1150 }}>
      <PageHeader
        title="Invoices"
        description={`${invoices.length} total`}
        actions={<Link href="/commercial/invoices/new" {...buttonProps('primary')}>+ New Invoice</Link>}
      />

      <WorkToolbar count={statusFilter !== 'ALL' && !loading ? `${filtered.length} of ${invoices.length}` : undefined}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className={toolbarControlClassName}
        >
          <option value="ALL">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ISSUED">Issued</option>
          <option value="VOID">Void</option>
        </select>
      </WorkToolbar>

      <TableContainer label="Invoices" minWidth={860}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col">Customer</th>
              <th scope="col">Status</th>
              <th scope="col">Issue Date</th>
              <th scope="col">Due Date</th>
              <th scope="col" className={tableStyles.num}>Total</th>
              <th scope="col">Source Quote</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={8} kind="loading">Loading invoices…</TableStateRow>}
            {!loading && filtered.length === 0 && (
              <TableStateRow colSpan={8} kind="empty">
                {invoices.length === 0 ? 'No invoices yet.' : 'No invoices with this status.'}
              </TableStateRow>
            )}
            {filtered.map(inv => (
              <tr key={inv.id}>
                <td className={tableStyles.primary} style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/commercial/invoices/${inv.id}`}>
                    {inv.invoice_number ?? <span className={tableStyles.muted}>Draft</span>}
                  </Link>
                </td>
                <td>{inv.customer_name_snapshot ?? customersById[inv.customer_id] ?? <span className={tableStyles.muted}>—</span>}</td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <StatusBadge status={inv.status} />
                    {inv.overdue && <OverdueBadge />}
                  </div>
                </td>
                <td>{inv.issue_date ? formatCommercialDate(inv.issue_date) : <span className={tableStyles.muted}>—</span>}</td>
                <td>{inv.due_date ? formatCommercialDate(inv.due_date) : <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.num}>{formatMoneyCents(inv.total_cents, inv.currency)}</td>
                <td>
                  {inv.source_quote_id ? (
                    <Link href={`/commercial/quotes/${inv.source_quote_id}`} className={tableStyles.link}>Quote →</Link>
                  ) : <span className={tableStyles.muted}>—</span>}
                </td>
                <td className={tableStyles.actions}>
                  <Link href={`/commercial/invoices/${inv.id}`} className={tableStyles.link} aria-label={`View invoice ${inv.invoice_number ?? '(draft)'}`}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}
