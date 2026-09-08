'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { resolveResourceCount, type ResourceCountState } from '@/lib/commercial/overviewCounts';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

type Counts = {
  customers: ResourceCountState;
  products: ResourceCountState;
  quotes: ResourceCountState;
  draftQuotes: ResourceCountState;
  invoices: ResourceCountState;
  draftInvoices: ResourceCountState;
};

// Phase C4.4A (Finding 3 remediation) — capability-aware by construction,
// not by ignoring failed responses. Previously this page unconditionally
// fetched /api/commercial/quotes (and, before this phase, /customers and
// /products would also have 403'd for an invoicing-only organisation)
// and treated a failed response's absent `.quotes`/`.customers` field as
// "0" via `?? 0` — genuinely misleading: an invoicing-only organisation
// would have seen "0 Quotes" on its own Overview page, which reads as
// "you have zero quotes" rather than the true state, "you don't have
// Quotes access at all." This page now reads the organisation's own
// enabledCapabilities from /api/me FIRST (the same mechanism
// app/commercial/quotes/[id]/page.tsx already uses for its own
// "Create Invoice" gating) and only ever fetches — and only ever
// renders a stat card for — a resource the organisation actually has
// capability access to. Customers/Products (shared resources, per
// Finding 3's own remediation in lib/commercial/authorize.ts) are
// fetched whenever EITHER Quotes or Invoicing is enabled, matching the
// API layer's own new OR-gated access.
//
// Phase C4.4A (blocker fix) — a SECOND, previously-missed distinction:
// an enabled capability whose fetch genuinely FAILED (a non-403, e.g. a
// transient 500) must never be conflated with an enabled capability
// that fetched successfully with zero real records. Both used to
// collapse to the same on-screen "0" via `?? 0`. `resolveResourceCount`
// (lib/commercial/overviewCounts.ts) is the single, pure, independently
// testable rule for the resulting three-way state per resource:
// 'unavailable' (not entitled) / 'error' (entitled, request failed) /
// a real number (entitled, request succeeded, including a legitimate 0).
export default function CommercialOverviewPage() {
  const [hasQuotes, setHasQuotes] = useState(false);
  const [hasInvoicing, setHasInvoicing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Counts>({
    customers: 'unavailable', products: 'unavailable', quotes: 'unavailable',
    draftQuotes: 'unavailable', invoices: 'unavailable', draftInvoices: 'unavailable',
  });

  useEffect(() => {
    (async () => {
      const meRes = await fetch('/api/me');
      const me = meRes.ok ? await meRes.json() : { enabledCapabilities: [] };
      const capabilityKeys = new Set((me.enabledCapabilities ?? []).map((c: { key: string }) => c.key));
      const quotes = capabilityKeys.has('quotes');
      const invoicing = capabilityKeys.has('invoicing');
      setHasQuotes(quotes);
      setHasInvoicing(invoicing);

      // Shared resources: fetched whenever either capability is
      // present, exactly matching the API layer's own
      // ['quotes', 'invoicing'] OR-gate.
      const wantsShared = quotes || invoicing;
      const [customersRes, productsRes, quotesRes, invoicesRes] = await Promise.all([
        wantsShared ? fetch('/api/commercial/customers') : Promise.resolve(null),
        wantsShared ? fetch('/api/commercial/products') : Promise.resolve(null),
        quotes ? fetch('/api/commercial/quotes') : Promise.resolve(null),
        invoicing ? fetch('/api/commercial/invoices') : Promise.resolve(null),
      ]);

      // `ok` is tracked per resource, independently of every other
      // resource's outcome — one failed enabled fetch never taints an
      // unrelated resource's own (possibly successful) count.
      const customersOk = wantsShared ? !!customersRes?.ok : false;
      const productsOk = wantsShared ? !!productsRes?.ok : false;
      const quotesOk = quotes ? !!quotesRes?.ok : false;
      const invoicesOk = invoicing ? !!invoicesRes?.ok : false;

      const customersData = customersOk ? await customersRes!.json() : null;
      const productsData = productsOk ? await productsRes!.json() : null;
      const quotesData = quotesOk ? await quotesRes!.json() : null;
      const invoicesData = invoicesOk ? await invoicesRes!.json() : null;

      const draftQuotesLength = quotesOk
        ? (quotesData?.quotes ?? []).filter((q: { status: string }) => q.status === 'DRAFT').length
        : undefined;
      const draftInvoicesLength = invoicesOk
        ? (invoicesData?.invoices ?? []).filter((i: { status: string }) => i.status === 'DRAFT').length
        : undefined;

      setCounts({
        customers: resolveResourceCount(wantsShared, customersOk, customersData?.customers?.length),
        products: resolveResourceCount(wantsShared, productsOk, productsData?.products?.length),
        quotes: resolveResourceCount(quotes, quotesOk, quotesData?.quotes?.length),
        draftQuotes: resolveResourceCount(quotes, quotesOk, draftQuotesLength),
        invoices: resolveResourceCount(invoicing, invoicesOk, invoicesData?.invoices?.length),
        draftInvoices: resolveResourceCount(invoicing, invoicesOk, draftInvoicesLength),
      });
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 24px' }}>Commercial</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 32 }}>
        {(hasQuotes || hasInvoicing) && <StatCard label="Customers" value={loading ? undefined : counts.customers} href="/commercial/customers" />}
        {(hasQuotes || hasInvoicing) && <StatCard label="Products & Services" value={loading ? undefined : counts.products} href="/commercial/products" />}
        {hasQuotes && <StatCard label="Quotes" value={loading ? undefined : counts.quotes} href="/commercial/quotes" />}
        {hasQuotes && <StatCard label="Draft Quotes" value={loading ? undefined : counts.draftQuotes} href="/commercial/quotes?status=DRAFT" />}
        {hasInvoicing && <StatCard label="Invoices" value={loading ? undefined : counts.invoices} href="/commercial/invoices" />}
        {hasInvoicing && <StatCard label="Draft Invoices" value={loading ? undefined : counts.draftInvoices} href="/commercial/invoices?status=DRAFT" />}
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px' }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>Get started</h2>
        {hasQuotes && (
          <>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 14px', lineHeight: 1.6 }}>
              Add a customer and a product or service, then create your first quote.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href="/commercial/customers" style={linkBtn}>Manage Customers →</Link>
              <Link href="/commercial/quotes/new" style={linkBtn}>New Quote →</Link>
            </div>
          </>
        )}
        {!hasQuotes && hasInvoicing && (
          <>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 14px', lineHeight: 1.6 }}>
              Add a customer and a product or service, then create your first invoice.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href="/commercial/customers" style={linkBtn}>Manage Customers →</Link>
              <Link href="/commercial/invoices/new" style={linkBtn}>New Invoice →</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: ResourceCountState | undefined; href: string }) {
  // undefined (still loading) and 'unavailable' (not entitled) both
  // render as "—". 'error' (entitled, request failed) renders as a
  // visibly distinct "Error" — it must never be mistaken for a real
  // zero count.
  const display = value === undefined || value === 'unavailable' ? '—' : value === 'error' ? 'Error' : value;
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: value === 'error' ? '#f87171' : '#f9fafb' }}>{display}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{label}</div>
      </div>
    </Link>
  );
}

const linkBtn: React.CSSProperties = { padding: '8px 14px', background: '#1a6aff', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' };
