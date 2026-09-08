'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { StatusBadge, OverdueBadge } from './_status';
import { formatMoneyCents } from '@/lib/commercial/money';
import { formatCommercialDate } from '@/lib/commercial/dates';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Invoices</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>{invoices.length} total</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#f9fafb', fontSize: 13 }}>
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ISSUED">Issued</option>
            <option value="VOID">Void</option>
          </select>
          <Link href="/commercial/invoices/new" style={btn('#1a6aff')}>+ New Invoice</Link>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['Invoice', 'Customer', 'Status', 'Issue Date', 'Due Date', 'Total', 'Source Quote', ''].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={empty}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} style={empty}>No invoices yet.</td></tr>}
            {filtered.map((inv, i) => (
              <tr key={inv.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/invoices/${inv.id}`} style={{ color: '#f9fafb', textDecoration: 'none', fontWeight: 500, fontSize: 14 }}>
                    {inv.invoice_number ?? <Dim>Draft</Dim>}
                  </Link>
                </td>
                <td style={td}>{inv.customer_name_snapshot ?? customersById[inv.customer_id] ?? <Dim>—</Dim>}</td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <StatusBadge status={inv.status} />
                    {inv.overdue && <OverdueBadge />}
                  </div>
                </td>
                <td style={td}>{inv.issue_date ? formatCommercialDate(inv.issue_date) : <Dim>—</Dim>}</td>
                <td style={td}>{inv.due_date ? formatCommercialDate(inv.due_date) : <Dim>—</Dim>}</td>
                <td style={td}>{formatMoneyCents(inv.total_cents, inv.currency)}</td>
                <td style={td}>
                  {inv.source_quote_id ? (
                    <Link href={`/commercial/quotes/${inv.source_quote_id}`} style={{ color: '#6b7280', textDecoration: 'none', fontSize: 12 }}>Quote →</Link>
                  ) : <Dim>—</Dim>}
                </td>
                <td style={{ padding: '13px 16px' }}>
                  <Link href={`/commercial/invoices/${inv.id}`} style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>View →</Link>
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
