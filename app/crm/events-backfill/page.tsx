'use client';
import { useState } from 'react';

const CARD = '#0e1014';
const BORDER = '#1a1d24';

type ClassificationPreviewRow = {
  contactId: string;
  name: string;
  email: string | null;
  currentClassification: string | null;
  notesMarker: string | null;
  linkedEventOrderCount: number;
  eventActivityCount: number;
  eligible: boolean;
  skipReason: string | null;
};

type ClassificationPreviewResult = {
  crmEnabled: boolean;
  totalCandidates: number;
  eligibleCount: number;
  rows: ClassificationPreviewRow[];
};

type ClassificationExecutionRow = {
  contactId: string;
  name: string;
  outcome: 'updated' | 'skipped_already_classified' | 'skipped_no_marker' | 'skipped_no_order_link' | 'skipped_stale' | 'failed';
  error?: string;
};

type ClassificationExecutionResult = {
  success: boolean;
  crmEnabled: boolean;
  eligibleAtExecution: number;
  updatedCount: number;
  skippedCount: number;
  updated: ClassificationExecutionRow[];
  skipped: ClassificationExecutionRow[];
};

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

  const [classificationPreview, setClassificationPreview] = useState<ClassificationPreviewResult | null>(null);
  const [classificationExecution, setClassificationExecution] = useState<ClassificationExecutionResult | null>(null);
  const [classificationLoading, setClassificationLoading] = useState(false);
  const [classificationExecuting, setClassificationExecuting] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const [classificationForbidden, setClassificationForbidden] = useState(false);

  // See lib/crm/eventContactClassificationBackfill.ts for the
  // eligibility logic this table reflects. GET is re-fetchable any
  // number of times with zero side effects.
  async function runClassificationPreview() {
    setClassificationLoading(true); setClassificationError(null); setClassificationForbidden(false);
    try {
      const res = await fetch('/api/crm/events-backfill/classification');
      if (res.status === 401 || res.status === 403) { setClassificationForbidden(true); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setClassificationError(body.error ?? `Preview failed (${res.status}).`); return; }
      setClassificationPreview(body);
    } catch { setClassificationError('Preview failed. Please try again.'); }
    finally { setClassificationLoading(false); }
  }

  // Distinct from runExecute() above — this is the classification
  // section's own execute flow, deliberately not mixed with the
  // separate order-linking execution above it on this page. The server
  // re-checks eligibility itself at execution time (a contact this
  // preview shows as eligible may have been classified elsewhere in
  // the meantime) — the confirm text says so plainly rather than
  // implying the count on screen is a guaranteed outcome.
  async function runClassificationExecute() {
    if (!classificationPreview) return;
    const summary = `Classify ${classificationPreview.eligibleCount} currently-eligible contact(s) as Event Contact? The server will re-check eligibility for each one right before writing it, so the actual count classified may be lower if anything changed since this preview. Contacts already classified as Client, Lead, Supplier, Partner, or Other are never overwritten.`;
    if (!confirm(summary)) return;
    setClassificationExecuting(true); setClassificationError(null);
    try {
      const res = await fetch('/api/crm/events-backfill/classification', { method: 'POST' });
      if (res.status === 401 || res.status === 403) { setClassificationForbidden(true); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setClassificationError(body.error ?? `Execution failed (${res.status}).`); return; }
      setClassificationExecution(body);
      await runClassificationPreview();
    } catch { setClassificationError('Execution failed. Please try again.'); }
    finally { setClassificationExecuting(false); }
  }

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

      <div style={{ marginTop: 40, paddingTop: 32, borderTop: `1px solid ${BORDER}` }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>Classify existing Events contacts</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 14px', maxWidth: 620 }}>
          Finds existing CRM contacts with Events evidence (an intact &quot;Events / …&quot; note and a live linked
          order) that are still unclassified, so they can be reviewed before being marked as Event Contacts.
          <strong style={{ color: '#9ca3af' }}> This preview makes no changes</strong> — nothing is classified until
          you explicitly confirm the action below.
        </p>

        {classificationForbidden && (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, color: '#9ca3af', fontSize: 14 }}>
            This action requires an admin role and both the Events and CRM capabilities enabled for your organisation.
          </div>
        )}

        {classificationError && <div role="alert" style={{ color: '#f87171', fontSize: 13, marginBottom: 16 }}>{classificationError}</div>}

        {!classificationForbidden && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button
              onClick={() => { setClassificationExecution(null); runClassificationPreview(); }}
              disabled={classificationLoading}
              style={btn('#1a6aff', classificationLoading)}
            >
              {classificationLoading ? 'Loading preview…' : classificationPreview ? 'Refresh preview' : 'Preview'}
            </button>
            {classificationPreview && classificationPreview.crmEnabled && classificationPreview.eligibleCount > 0 && (
              <button onClick={runClassificationExecute} disabled={classificationExecuting} style={btn('#16a34a', classificationExecuting)}>
                {classificationExecuting ? 'Classifying…' : `Classify as Event Contact (${classificationPreview.eligibleCount})`}
              </button>
            )}
          </div>
        )}

        {classificationExecution && (
          <div style={{ marginBottom: 20 }}>
            <SummaryGrid
              items={[
                ['Eligible at execution', classificationExecution.eligibleAtExecution],
                ['Classified', classificationExecution.updatedCount],
                ['Skipped', classificationExecution.skippedCount],
              ]}
            />
            {classificationExecution.skipped.some(r => r.outcome === 'failed') && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginTop: 20 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {['Contact', 'Outcome', 'Error'].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {classificationExecution.skipped.filter(r => r.outcome === 'failed').map((r, i, arr) => (
                      <tr key={r.contactId} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                        <td style={td}>{r.name}</td>
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

        {classificationPreview && !classificationPreview.crmEnabled && (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, color: '#9ca3af', fontSize: 14 }}>
            CRM isn&apos;t enabled for your organisation.
          </div>
        )}

        {classificationPreview && classificationPreview.crmEnabled && (
          <>
            <SummaryGrid
              items={[
                ['Candidates found', classificationPreview.totalCandidates],
                ['Eligible', classificationPreview.eligibleCount],
                ['Not eligible', classificationPreview.totalCandidates - classificationPreview.eligibleCount],
              ]}
            />

            {classificationPreview.rows.length > 0 && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', marginTop: 20 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {['Contact', 'Email', 'Current classification', 'Events evidence', 'Linked orders', 'Activities', 'Status'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {classificationPreview.rows.map((r, i) => (
                      <tr key={r.contactId} style={{ borderBottom: i < classificationPreview.rows.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                        <td style={td}>{r.name}</td>
                        <td style={td}>{r.email ?? '—'}</td>
                        <td style={td}>{r.currentClassification ?? '—'}</td>
                        <td style={td}>{r.notesMarker ?? '—'}</td>
                        <td style={td}>{r.linkedEventOrderCount}</td>
                        <td style={td}>{r.eventActivityCount}</td>
                        <td style={td}><ClassificationStatusBadge eligible={r.eligible} skipReason={r.skipReason} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
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

function ClassificationStatusBadge({ eligible, skipReason }: { eligible: boolean; skipReason: string | null }) {
  if (eligible) return <span style={{ color: '#4ade80', fontSize: 12.5, fontWeight: 600 }}>Eligible</span>;
  return <span style={{ color: '#6b7280', fontSize: 12.5 }}>{skipReason ?? 'Not eligible'}</span>;
}
