'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { StatusBadge } from './_status';
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

type Quote = {
  id: string; quote_number: string | null; status: string; customer_id: string;
  customer_name_snapshot: string | null; issue_date: string | null; expiry_date: string | null;
  total_cents: number; currency: string; created_at: string; updated_at: string;
};
type Customer = { id: string; name: string };

export default function QuotesPage() {
  const searchParams = useSearchParams();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customersById, setCustomersById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'ALL');

  async function load() {
    const [quotesRes, customersRes] = await Promise.all([
      fetch('/api/commercial/quotes'),
      fetch('/api/commercial/customers'),
    ]);
    const quotesData = await quotesRes.json();
    const customersData = await customersRes.json();
    setQuotes(quotesData.quotes ?? []);
    setCustomersById(Object.fromEntries((customersData.customers ?? []).map((c: Customer) => [c.id, c.name])));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'ALL' ? quotes : quotes.filter(q => q.status === statusFilter);

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Quotes"
        description={`${quotes.length} total`}
        actions={<Link href="/commercial/quotes/new" {...buttonProps('primary')}>+ New Quote</Link>}
      />

      <WorkToolbar count={statusFilter !== 'ALL' && !loading ? `${filtered.length} of ${quotes.length}` : undefined}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className={toolbarControlClassName}
        >
          <option value="ALL">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </WorkToolbar>

      <TableContainer label="Quotes" minWidth={780}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Customer</th>
              <th scope="col">Status</th>
              <th scope="col">Issue Date</th>
              <th scope="col">Expiry</th>
              <th scope="col" className={tableStyles.num}>Total</th>
              <th scope="col" className={tableStyles.actions}><span className="bb-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableStateRow colSpan={7} kind="loading">Loading quotes…</TableStateRow>}
            {!loading && filtered.length === 0 && <TableStateRow colSpan={7} kind="empty">No quotes yet.</TableStateRow>}
            {filtered.map(q => (
              <tr key={q.id}>
                <td className={tableStyles.primary} style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/commercial/quotes/${q.id}`}>
                    {q.quote_number ?? <span className={tableStyles.muted}>Draft</span>}
                  </Link>
                </td>
                <td>{q.customer_name_snapshot ?? customersById[q.customer_id] ?? <span className={tableStyles.muted}>—</span>}</td>
                <td><StatusBadge status={q.status} /></td>
                <td>{q.issue_date ? formatCommercialDate(q.issue_date) : <span className={tableStyles.muted}>—</span>}</td>
                <td>{q.expiry_date ? formatCommercialDate(q.expiry_date) : <span className={tableStyles.muted}>—</span>}</td>
                <td className={tableStyles.num}>{formatMoneyCents(q.total_cents, q.currency)}</td>
                <td className={tableStyles.actions}>
                  <Link href={`/commercial/quotes/${q.id}`} className={tableStyles.link} aria-label={`View quote ${q.quote_number ?? '(draft)'}`}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}
