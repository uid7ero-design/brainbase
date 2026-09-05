'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const CARD = '#0e1014'; const BORDER = '#1a1d24';

export default function CommercialOverviewPage() {
  const [counts, setCounts] = useState<{ customers: number; products: number; quotes: number; draftQuotes: number } | null>(null);

  useEffect(() => {
    (async () => {
      const [customersRes, productsRes, quotesRes] = await Promise.all([
        fetch('/api/commercial/customers'),
        fetch('/api/commercial/products'),
        fetch('/api/commercial/quotes'),
      ]);
      const [customers, products, quotes] = await Promise.all([customersRes.json(), productsRes.json(), quotesRes.json()]);
      setCounts({
        customers: customers.customers?.length ?? 0,
        products: products.products?.length ?? 0,
        quotes: quotes.quotes?.length ?? 0,
        draftQuotes: (quotes.quotes ?? []).filter((q: { status: string }) => q.status === 'DRAFT').length,
      });
    })();
  }, []);

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 24px' }}>Commercial</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 32 }}>
        <StatCard label="Customers" value={counts?.customers} href="/commercial/customers" />
        <StatCard label="Products & Services" value={counts?.products} href="/commercial/products" />
        <StatCard label="Quotes" value={counts?.quotes} href="/commercial/quotes" />
        <StatCard label="Draft Quotes" value={counts?.draftQuotes} href="/commercial/quotes?status=DRAFT" />
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px' }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>Get started</h2>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 14px', lineHeight: 1.6 }}>
          Add a customer and a product or service, then create your first quote.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/commercial/customers" style={linkBtn}>Manage Customers →</Link>
          <Link href="/commercial/quotes/new" style={linkBtn}>New Quote →</Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number | undefined; href: string }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#f9fafb' }}>{value ?? '—'}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{label}</div>
      </div>
    </Link>
  );
}

const linkBtn: React.CSSProperties = { padding: '8px 14px', background: '#1a6aff', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' };
