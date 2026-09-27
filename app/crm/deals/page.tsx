'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import DealForm from '../_components/DealForm';
import { Button, PageHeader } from '@/components/ui/app';

const BORDER = 'var(--border)';

// Domain category encoding (kept) — deal pipeline stages. Semantic stages use
// status tokens; "proposal" keeps its own category hue. Colour is drawn as the
// column dot and card edge only, always beside the written stage label.
const STAGES = [
  { key: 'lead', label: 'Lead', color: 'var(--status-inactive)' },
  { key: 'qualified', label: 'Qualified', color: 'var(--status-info)' },
  { key: 'proposal', label: 'Proposal', color: '#f472b6' },
  { key: 'negotiation', label: 'Negotiation', color: 'var(--status-warning)' },
  { key: 'closed_won', label: 'Won', color: 'var(--status-success)' },
  { key: 'closed_lost', label: 'Lost', color: 'var(--status-danger)' },
];

type Deal = { id: string; title: string; value: number | null; stage: string; company_name: string | null; contact_name: string | null; expected_close: string | null; assigned_to_name: string | null; probability: number };

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/crm/deals');
    if (res.ok) setDeals((await res.json()).deals);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function moveStage(dealId: string, newStage: string) {
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) return;
    setDeals(ds => ds.map(d => d.id === dealId ? { ...d, stage: newStage } : d));
    await fetch(`/api/crm/deals/${dealId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...deal, stage: newStage }),
    });
  }

  const totalPipeline = deals
    .filter(d => !['closed_won', 'closed_lost'].includes(d.stage))
    .reduce((s, d) => s + (d.value ?? 0), 0);
  const totalWon = deals.filter(d => d.stage === 'closed_won').reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Deals"
        description={
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 16px', fontVariantNumeric: 'tabular-nums' }}>
            <span>{deals.length} deals</span>
            {totalPipeline > 0 && <span>${totalPipeline.toLocaleString()} in pipeline</span>}
            {totalWon > 0 && <span>${totalWon.toLocaleString()} won</span>}
          </span>
        }
        actions={<Button variant="primary" onClick={() => setShowAdd(true)}>+ Add Deal</Button>}
      />

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
        {STAGES.map(stage => {
          const col = deals.filter(d => d.stage === stage.key);
          const colValue = col.reduce((s, d) => s + (d.value ?? 0), 0);
          return (
            <section
              key={stage.key}
              aria-labelledby={`stage-${stage.key}`}
              style={{ minWidth: 240, flex: '0 0 240px' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (dragging) moveStage(dragging, stage.key); setDragging(null); }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color }} />
                  <h2 id={`stage-${stage.key}`} style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stage.label}</h2>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--status-inactive-muted)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontVariantNumeric: 'tabular-nums' }}>{col.length}</span>
                </div>
                {colValue > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>${colValue.toLocaleString()}</span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 }}>
                {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 8 }}>Loading…</div>}
                {col.map(deal => (
                  // Native button: the card opens the edit drawer by click,
                  // Enter or Space (stage can be changed there by keyboard);
                  // drag-and-drop between columns stays as a pointer shortcut.
                  <button
                    type="button"
                    key={deal.id}
                    draggable
                    onDragStart={() => setDragging(deal.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => setEditDeal(deal)}
                    aria-label={`Edit deal: ${deal.title}`}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit',
                      background: 'var(--bg-surface)', border: `1px solid ${BORDER}`, borderRadius: 'var(--radius-lg)',
                      padding: '14px 14px', cursor: 'grab',
                      opacity: dragging === deal.id ? 0.4 : 1,
                      transition: 'opacity .15s',
                      borderLeft: `3px solid ${stage.color}`,
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6, lineHeight: 1.3 }}>{deal.title}</span>
                    {deal.company_name && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{deal.company_name}</span>}
                    {deal.contact_name && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{deal.contact_name}</span>}
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                      {deal.value != null
                        ? <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>${Number(deal.value).toLocaleString()}</span>
                        : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No value</span>}
                      {deal.probability > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{deal.probability}%</span>}
                    </span>
                    {deal.expected_close && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                        Close {new Date(deal.expected_close).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <SlidePanel open={showAdd} onClose={() => setShowAdd(false)} title="Add Deal">
        <DealForm onSaved={() => { setShowAdd(false); load(); }} />
      </SlidePanel>

      <SlidePanel open={!!editDeal} onClose={() => setEditDeal(null)} title="Edit Deal">
        {editDeal && (
          <DealForm initial={editDeal} onSaved={() => { setEditDeal(null); load(); }}
            onDelete={() => { setEditDeal(null); load(); }} />
        )}
      </SlidePanel>
    </div>
  );
}
