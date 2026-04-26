'use client';
import { useEffect, useState } from 'react';
import SlidePanel from '../_components/SlidePanel';
import DealForm from '../_components/DealForm';

const BORDER = '#1a1d24';

const STAGES = [
  { key: 'lead',        label: 'Lead',        color: '#6b7280' },
  { key: 'qualified',   label: 'Qualified',   color: '#60a5fa' },
  { key: 'proposal',    label: 'Proposal',    color: '#a78bfa' },
  { key: 'negotiation', label: 'Negotiation', color: '#fbbf24' },
  { key: 'closed_won',  label: 'Won',         color: '#34d399' },
  { key: 'closed_lost', label: 'Lost',        color: '#f87171' },
];

type Deal = { id: string; title: string; value: number | null; stage: string; company_name: string | null; contact_name: string | null; expected_close: string | null; assigned_to_name: string | null; probability: number };

export default function DealsPage() {
  const [deals, setDeals]     = useState<Deal[]>([]);
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
    .filter(d => !['closed_won','closed_lost'].includes(d.stage))
    .reduce((s, d) => s + (d.value ?? 0), 0);
  const totalWon = deals.filter(d => d.stage === 'closed_won').reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Pipeline</h1>
          <span style={{ fontSize: 13, color: '#6b7280' }}>{deals.length} deals</span>
          {totalPipeline > 0 && <span style={{ fontSize: 13, color: '#a78bfa' }}>${totalPipeline.toLocaleString()} in pipeline</span>}
          {totalWon > 0 && <span style={{ fontSize: 13, color: '#34d399' }}>${totalWon.toLocaleString()} won</span>}
        </div>
        <button onClick={() => setShowAdd(true)} style={addBtn}>+ Add Deal</button>
      </div>

      {/* Kanban */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16 }}>
        {STAGES.map(stage => {
          const col = deals.filter(d => d.stage === stage.key);
          const colValue = col.reduce((s, d) => s + (d.value ?? 0), 0);
          return (
            <div
              key={stage.key}
              style={{ minWidth: 240, flex: '0 0 240px' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (dragging) moveStage(dragging, stage.key); setDragging(null); }}
            >
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#d1d5db', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stage.label}</span>
                  <span style={{ fontSize: 11, color: '#4b5563', background: '#1a1d24', padding: '1px 6px', borderRadius: 10 }}>{col.length}</span>
                </div>
                {colValue > 0 && <span style={{ fontSize: 11, color: '#6b7280' }}>${colValue.toLocaleString()}</span>}
              </div>

              {/* Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 }}>
                {loading && <div style={{ color: '#4b5563', fontSize: 13, padding: 8 }}>Loading…</div>}
                {col.map(deal => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={() => setDragging(deal.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => setEditDeal(deal)}
                    style={{
                      background: '#0e1014', border: `1px solid ${BORDER}`, borderRadius: 10,
                      padding: '14px 14px', cursor: 'grab',
                      opacity: dragging === deal.id ? 0.4 : 1,
                      transition: 'opacity .15s',
                      borderLeft: `3px solid ${stage.color}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#f9fafb', marginBottom: 6, lineHeight: 1.3 }}>{deal.title}</div>
                    {deal.company_name && <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{deal.company_name}</div>}
                    {deal.contact_name && <div style={{ fontSize: 11, color: '#4b5563' }}>{deal.contact_name}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                      {deal.value != null
                        ? <span style={{ fontSize: 13, fontWeight: 600, color: stage.color }}>${Number(deal.value).toLocaleString()}</span>
                        : <span style={{ fontSize: 11, color: '#4b5563' }}>No value</span>}
                      {deal.probability > 0 && <span style={{ fontSize: 11, color: '#6b7280' }}>{deal.probability}%</span>}
                    </div>
                    {deal.expected_close && (
                      <div style={{ fontSize: 11, color: '#4b5563', marginTop: 6 }}>
                        Close {new Date(deal.expected_close).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
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

const addBtn: React.CSSProperties = { padding: '8px 16px', background: '#1a6aff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
