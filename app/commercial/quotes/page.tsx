'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { StatusBadge } from './_status';
import { formatMoneyCents } from '@/lib/commercial/money';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Quotes</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{quotes.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13 }}>
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SENT">Sent</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="REJECTED">Rejected</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <Link href="/commercial/quotes/new" style={btn('#1a6aff')}>+ New Quote</Link>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Number', 'Customer', 'Status', 'Issue Date', 'Expiry', 'Total', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={7} style={empty}>No quotes yet.</td></tr>}
            {filtered.map((q, i) => (
              <tr key={q.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/quotes/${q.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
                    {q.quote_number ?? <Dim>Draft</Dim>}
                  </Link>
                </td>
                <td style={td}>{q.customer_name_snapshot ?? customersById[q.customer_id] ?? <Dim>—</Dim>}</td>
                <td style={td}><StatusBadge status={q.status} /></td>
                <td style={td}>{q.issue_date ?? <Dim>—</Dim>}</td>
                <td style={td}>{q.expiry_date ?? <Dim>—</Dim>}</td>
                <td style={td}>{formatMoneyCents(q.total_cents, q.currency)}</td>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/quotes/${q.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#4b5563' }}>{children}</span>;
}

const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '13px 16px', fontSize: 13, color: '#9ca3af' };
const empty: React.CSSProperties = { padding: '36px 16px', textAlign: 'center', color: '#4b5563', fontSize: 14 };
function btn(bg: string): React.CSSProperties { return { padding: '8px 16px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }; }
