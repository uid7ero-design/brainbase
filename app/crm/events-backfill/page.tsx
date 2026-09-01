'use client';
import { useState } from 'react';

const CARD = '#0e1014';
const BORDER = '#1a1d24';

type PreviewResult = {
  crmEnabled: boolean;
  totalUnlinkedOrders: number;
  alreadyLinkedOrders: number;
  wouldLinkExisting: number;
  wouldCreateNew: number;
  skippedInsufficientIdentity: number;
  ambiguous: number;
  rows: Array<{
    orderId: string; purchaserName: string; purchaserEmail: string | null; purchaserPhone: string | null;
    classification: 'would_link_existing' | 'would_create_new' | 'skipped_insufficient_identity' | 'ambiguous';
    matchCount: number; existingContactId: string | null;
  }>;
};

type ExecutionResult = {
  crmEnabled: boolean;
  processed: number;
  linkedExisting: number;
  createdNew: number;
  skippedInsufficientIdentity: number;
  ambiguousSkipped: number;
  failed: number;
  results: Array<{ orderId: string; outcome: string; contactId: string | null; error?: string }>;
};

function btn(bg: string, disabled?: boolean): React.CSSProperties {
  return { padding: '9px 18px', background: bg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
}
const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' };
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: '#e5e7eb' };

// Phase 6.2 — "Backfill Event Contacts". Strictly preview-first (§5,
// §8): the ONLY way to reach POST (a real write) is by clicking
// Execute after a preview has already been fetched and its counts are
// on screen — there is no one-click destructive path. GET (preview) is
// re-fetchable any number of times with zero side effects; every
// number shown here comes directly from the server's own classification
// (lib/crm/eventBackfill.ts), never recomputed or guessed client-side.
export default function EventsBackfillPage() {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  async function runPreview() {
    setLoading(true); setError(null); setExecution(null); setForbidden(false);
    try {
      const res = await fetch('/api/crm/events-backfill');
      if (res.status === 401 || res.status === 403) { setForbidden(true); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `Preview failed (${res.status}).`); return; }
      setPreview(body);
    } catch { setError('Preview failed. Please try again.'); }
    finally { setLoading(false); }
  }

  async function runExecute() {
    if (!preview) return;
    const summary = `Link ${preview.wouldLinkExisting} order(s) to existing CRM contacts and create ${preview.wouldCreateNew} new contact(s)? ${preview.ambiguous} ambiguous and ${preview.skippedInsufficientIdentity} insufficient-identity order(s) will be skipped and reported, not guessed.`;
    if (!confirm(summary)) return;
    setExecuting(true); setError(null);
    try {
      const res = await fetch('/api/crm/events-backfill', { method: 'POST' });
      if (res.status === 401 || res.status === 403) { setForbidden(true); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `Execution failed (${res.status}).`); return; }
      setExecution(body);
      setPreview(null);
    } catch { setError('Execution failed. Please try again.'); }
    finally { setExecuting(false); }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>Backfill Event Contacts</h1>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0', maxWidth: 620 }}>
          Links historical event registrations that predate CRM sync (or were created while CRM was disabled) to a
          CRM contact — reusing an existing contact by email or phone where a safe, unambiguous match exists, or
          creating a new one. Only purchaser name/email/phone are ever read or written; registration answers and
          internal notes are never touched. Nothing is changed until you review a preview and explicitly confirm.
        </p>
      </div>

      {forbidden && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, color: '#9ca3af', fontSize: 14 }}>
          This action requires an admin role and both the Events and CRM capabilities enabled for your organisation.
        </div>
      )}

      {error && <div role="alert" style={{ color: '#f87171', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {!forbidden && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <button onClick={runPreview} disabled={loading} style={btn('#1a6aff', loading)}>
            {loading ? 'Loading preview…' : preview ? 'Refresh preview' : 'Preview'}
          </button>
          {preview && preview.crmEnabled && (preview.wouldLinkExisting + preview.wouldCreateNew > 0) && (
            <button onClick={runExecute} disabled={executing} style={btn('#16a34a', executing)}>
              {executing ? 'Running…' : `Execute (${preview.wouldLinkExisting + preview.wouldCreateNew} order(s))`}
            </button>
          )}
        </div>
      )}

      {preview && !preview.crmEnabled && (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, color: '#9ca3af', fontSize: 14 }}>
          CRM isn&apos;t enabled for your organisation.
        </div>
      )}

      {preview && preview.crmEnabled && (
        <>
          <SummaryGrid
            items={[
              ['Total unlinked orders', preview.totalUnlinkedOrders],
              ['Already linked', preview.alreadyLinkedOrders],
              ['Would link to existing contact', preview.wouldLinkExisting],
              ['Would create new contact', preview.wouldCreateNew],
              ['Skipped — insufficient identity', preview.skippedInsufficientIdentity],
              ['Ambiguous — needs manual review', preview.ambiguous],
            ]}
          />

          {preview.rows.length > 0 && (
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginTop: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {['Purchaser', 'Email', 'Phone', 'Result'].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={r.orderId} style={{ borderBottom: i < preview.rows.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                      <td style={td}>{r.purchaserName}</td>
                      <td style={td}>{r.purchaserEmail ?? '—'}</td>
                      <td style={td}>{r.purchaserPhone ?? '—'}</td>
                      <td style={td}><ClassificationBadge classification={r.classification} matchCount={r.matchCount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {execution && (
        <div style={{ marginTop: 20 }}>
          <SummaryGrid
            items={[
              ['Processed', execution.processed],
              ['Linked to existing contact', execution.linkedExisting],
              ['New contact created', execution.createdNew],
              ['Skipped — insufficient identity', execution.skippedInsufficientIdentity],
              ['Skipped — ambiguous', execution.ambiguousSkipped],
              ['Failed', execution.failed],
            ]}
          />
          {execution.failed > 0 && (
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginTop: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {['Order', 'Outcome', 'Error'].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {execution.results.filter(r => r.outcome === 'failed').map((r, i, arr) => (
                    <tr key={r.orderId} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                      <td style={td}>{r.orderId}</td>
                      <td style={td}>{r.outcome}</td>
                      <td style={{ ...td, color: '#f87171' }}>{r.error ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryGrid({ items }: { items: Array<[string, number]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f9fafb' }}>{value}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function ClassificationBadge({ classification, matchCount }: { classification: string; matchCount: number }) {
  const map: Record<string, { label: string; color: string }> = {
    would_link_existing: { label: 'Link to existing', color: '#4ade80' },
    would_create_new: { label: 'Create new', color: '#60a5fa' },
    skipped_insufficient_identity: { label: 'No email/phone', color: '#6b7280' },
    ambiguous: { label: `Ambiguous (${matchCount} matches)`, color: '#fbbf24' },
  };
  const m = map[classification] ?? { label: classification, color: '#9ca3af' };
  return <span style={{ color: m.color, fontSize: 12.5, fontWeight: 600 }}>{m.label}</span>;
}
