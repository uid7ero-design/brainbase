'use client';
import { useState } from 'react';
import {
  Badge,
  Metric,
  MetricStrip,
  PageHeader,
  StateMessage,
  TableContainer,
  buttonProps,
  tableStyles,
} from '@/components/ui/app';

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

const ERROR_TEXT: React.CSSProperties = { color: 'var(--status-danger)', fontSize: 13, margin: '0 0 16px' };
const ACTIONS_ROW: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 };

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
      <PageHeader
        title="Backfill Event Contacts"
        description={
          <span style={{ display: 'block', maxWidth: 620 }}>
            Links historical event registrations that predate CRM sync (or were created while CRM was disabled) to a
            CRM contact — reusing an existing contact by email or phone where a safe, unambiguous match exists, or
            creating a new one. Only purchaser name/email/phone are ever read or written; registration answers and
            internal notes are never touched. Nothing is changed until you review a preview and explicitly confirm.
          </span>
        }
      />

      {forbidden && (
        <StateMessage kind="empty" title="This action requires an admin role and both the Events and CRM capabilities enabled for your organisation." />
      )}

      {error && <p role="alert" style={ERROR_TEXT}>{error}</p>}

      {!forbidden && (
        <div style={ACTIONS_ROW}>
          <button type="button" onClick={runPreview} disabled={loading} {...buttonProps('secondary')}>
            {loading ? 'Loading preview…' : preview ? 'Refresh preview' : 'Preview'}
          </button>
          {preview && preview.crmEnabled && (preview.wouldLinkExisting + preview.wouldCreateNew > 0) && (
            <button type="button" onClick={runExecute} disabled={executing} {...buttonProps('primary')}>
              {executing ? 'Running…' : `Execute (${preview.wouldLinkExisting + preview.wouldCreateNew} order(s))`}
            </button>
          )}
        </div>
      )}

      {preview && !preview.crmEnabled && (
        <StateMessage kind="empty" title="CRM isn't enabled for your organisation." />
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
            <div style={{ marginTop: 20 }}>
              <TableContainer label="Order-linking preview">
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      {['Purchaser', 'Email', 'Phone', 'Result'].map(h => <th key={h} scope="col">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(r => (
                      <tr key={r.orderId}>
                        <td className={tableStyles.primary}>{r.purchaserName}</td>
                        <td>{r.purchaserEmail ?? <span className={tableStyles.muted}>—</span>}</td>
                        <td>{r.purchaserPhone ?? <span className={tableStyles.muted}>—</span>}</td>
                        <td><ClassificationBadge classification={r.classification} matchCount={r.matchCount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
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
            <div style={{ marginTop: 20 }}>
              <TableContainer label="Failed orders">
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      {['Order', 'Outcome', 'Error'].map(h => <th key={h} scope="col">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {execution.results.filter(r => r.outcome === 'failed').map(r => (
                      <tr key={r.orderId}>
                        <td className={tableStyles.primary}>{r.orderId}</td>
                        <td><Badge state="error">{r.outcome}</Badge></td>
                        <td style={{ color: 'var(--status-danger)' }}>{r.error ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            </div>
          )}
        </div>
      )}

      <section aria-labelledby="classify-heading" style={{ marginTop: 40, paddingTop: 32, borderTop: '1px solid var(--border)' }}>
        <h2 id="classify-heading" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', margin: 0, color: 'var(--text-primary)' }}>Classify existing Events contacts</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 14px', maxWidth: 620 }}>
          Finds existing CRM contacts with Events evidence (an intact &quot;Events / …&quot; note and a live linked
          order) that are still unclassified, so they can be reviewed before being marked as Event Contacts.
          <strong style={{ color: 'var(--text-primary)' }}> This preview makes no changes</strong> — nothing is classified until
          you explicitly confirm the action below.
        </p>

        {classificationForbidden && (
          <StateMessage kind="empty" title="This action requires an admin role and both the Events and CRM capabilities enabled for your organisation." />
        )}

        {classificationError && <p role="alert" style={ERROR_TEXT}>{classificationError}</p>}

        {!classificationForbidden && (
          <div style={ACTIONS_ROW}>
            <button
              type="button"
              onClick={() => { setClassificationExecution(null); runClassificationPreview(); }}
              disabled={classificationLoading}
              {...buttonProps('secondary')}
            >
              {classificationLoading ? 'Loading preview…' : classificationPreview ? 'Refresh preview' : 'Preview'}
            </button>
            {classificationPreview && classificationPreview.crmEnabled && classificationPreview.eligibleCount > 0 && (
              <button type="button" onClick={runClassificationExecute} disabled={classificationExecuting} {...buttonProps('primary')}>
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
              <div style={{ marginTop: 20 }}>
                <TableContainer label="Failed classifications">
                  <table className={tableStyles.table}>
                    <thead>
                      <tr>
                        {['Contact', 'Outcome', 'Error'].map(h => <th key={h} scope="col">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {classificationExecution.skipped.filter(r => r.outcome === 'failed').map(r => (
                        <tr key={r.contactId}>
                          <td className={tableStyles.primary}>{r.name}</td>
                          <td><Badge state="error">{r.outcome}</Badge></td>
                          <td style={{ color: 'var(--status-danger)' }}>{r.error ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
              </div>
            )}
          </div>
        )}

        {classificationPreview && !classificationPreview.crmEnabled && (
          <StateMessage kind="empty" title="CRM isn't enabled for your organisation." />
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
              <div style={{ marginTop: 20 }}>
                <TableContainer label="Classification preview" minWidth={860}>
                  <table className={tableStyles.table}>
                    <thead>
                      <tr>
                        {['Contact', 'Email', 'Current classification', 'Events evidence', 'Linked orders', 'Activities', 'Status'].map(h => (
                          <th key={h} scope="col" className={h === 'Linked orders' || h === 'Activities' ? tableStyles.num : undefined}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {classificationPreview.rows.map(r => (
                        <tr key={r.contactId}>
                          <td className={tableStyles.primary}>{r.name}</td>
                          <td>{r.email ?? <span className={tableStyles.muted}>—</span>}</td>
                          <td>{r.currentClassification ?? <span className={tableStyles.muted}>—</span>}</td>
                          <td>{r.notesMarker ?? <span className={tableStyles.muted}>—</span>}</td>
                          <td className={tableStyles.num}>{r.linkedEventOrderCount}</td>
                          <td className={tableStyles.num}>{r.eventActivityCount}</td>
                          <td><ClassificationStatusBadge eligible={r.eligible} skipReason={r.skipReason} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function SummaryGrid({ items }: { items: Array<[string, number]> }) {
  return (
    <MetricStrip>
      {items.map(([label, value]) => (
        <Metric key={label} label={label} value={value} />
      ))}
    </MetricStrip>
  );
}

function ClassificationBadge({ classification, matchCount }: { classification: string; matchCount: number }) {
  const map: Record<string, { label: string; state: 'success' | 'info' | 'inactive' | 'warning' }> = {
    would_link_existing: { label: 'Link to existing', state: 'success' },
    would_create_new: { label: 'Create new', state: 'info' },
    skipped_insufficient_identity: { label: 'No email/phone', state: 'inactive' },
    ambiguous: { label: `Ambiguous (${matchCount} matches)`, state: 'warning' },
  };
  const m = map[classification] ?? { label: classification, state: 'inactive' as const };
  return <Badge state={m.state}>{m.label}</Badge>;
}

function ClassificationStatusBadge({ eligible, skipReason }: { eligible: boolean; skipReason: string | null }) {
  if (eligible) return <Badge state="success">Eligible</Badge>;
  return <span style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{skipReason ?? 'Not eligible'}</span>;
}
