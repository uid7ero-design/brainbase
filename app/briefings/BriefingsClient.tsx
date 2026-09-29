'use client';
import { useState, useEffect, useCallback, useId } from 'react';
import { generateReportHTML } from '../../lib/evidence-report';
import { Button, PageHeader, StateMessage, TableContainer, tableStyles } from '@/components/ui/app';
import styles from './Briefings.module.css';

// Remaining visual islands pass (4A): shell, filters, cards and evidence
// converge on the shared tokens + primitives. Agent identity hues below are
// DATA (which agent produced the briefing) — they colour the decorative
// glyph and identity dot only; every label sits on theme text tokens.
const AGENT_COLOR: Record<string, string> = {
  InsightAgent:    '#38BDF8',
  ActionAgent:     '#A78BFA',
  BriefingAgent:   '#34D399',
  DataIntakeAgent: '#FBBF24',
  HLNAChatAgent:   '#6366F1',
};
const DEFAULT_AGENT_COLOR = '#6366F1';
const AGENT_ICON: Record<string, string> = {
  InsightAgent:    '◎',
  ActionAgent:     '⚡',
  BriefingAgent:   '◈',
  DataIntakeAgent: '↑',
  HLNAChatAgent:   '◈',
};

const TYPE_LABELS: Record<string, string> = {
  insight:    'Insight',
  action:     'Action',
  briefing:   'Briefing',
  chat:       'Chat',
  dataIntake: 'Data Intake',
};

const FILTERS = [
  { key: null,         label: 'All' },
  { key: 'briefing',  label: 'Briefing' },
  { key: 'insight',   label: 'Insight' },
  { key: 'action',    label: 'Action' },
  { key: 'chat',      label: 'Chat' },
];

type Evidence = {
  sourceDataset: string[];
  sourceColumns: string[];
  evidenceSummary: string;
  calculationUsed: string;
  confidenceReason: string;
  sampleRows: Record<string, unknown>[];
};

type Briefing = {
  id: string;
  title: string;
  briefing_type: string | null;
  agent_name: string | null;
  response_text: string | null;
  evidence_json: Evidence | null;
  created_at: string;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function EvidencePanel({ evidence, id }: { evidence: Evidence; id: string }) {
  const sampleHeaders = evidence.sampleRows?.length > 0
    ? Object.keys(evidence.sampleRows[0]).slice(0, 6)
    : [];

  return (
    <div id={id} className={styles.evidence}>
      {/* Datasets + columns */}
      <div className={styles.evidenceRow}>
        <div>
          <p className={styles.evidenceLabel}>Datasets</p>
          <ul className={styles.chips}>
            {(evidence.sourceDataset ?? []).map(d => (
              <li key={d} className={styles.datasetChip}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className={styles.evidenceLabel}>Columns</p>
          <ul className={styles.chips}>
            {(evidence.sourceColumns ?? []).slice(0, 10).map(c => (
              <li key={c} className={styles.columnChip}>{c}</li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <p className={styles.evidenceLabel}>Evidence</p>
        <p className={styles.evidenceText}>{evidence.evidenceSummary}</p>
      </div>

      <div>
        <p className={styles.evidenceLabel}>Calculation</p>
        <p className={styles.calculation}>{evidence.calculationUsed}</p>
      </div>

      <div>
        <p className={styles.evidenceLabel}>Confidence reason</p>
        <p className={styles.evidenceText}>{evidence.confidenceReason}</p>
      </div>

      {sampleHeaders.length > 0 && (
        <div>
          <p className={styles.evidenceLabel}>
            Sample data ({Math.min(evidence.sampleRows.length, 3)} rows)
          </p>
          <TableContainer label="Sample data" minWidth={0}>
            <table className={`${tableStyles.table} ${styles.sampleTable}`}>
              <thead>
                <tr>
                  {sampleHeaders.map(h => (
                    <th key={h} scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.sampleRows.slice(0, 3).map((r, ri) => (
                  <tr key={ri}>
                    {sampleHeaders.map(h => (
                      <td key={h}>
                        {String(r[h] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
        </div>
      )}
    </div>
  );
}

function BriefingCard({ b, onDelete }: { b: Briefing; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const bodyId = useId();
  const evidenceId = useId();
  const color = AGENT_COLOR[b.agent_name ?? ''] ?? DEFAULT_AGENT_COLOR;
  const icon  = AGENT_ICON[b.agent_name ?? '']  ?? '◈';
  const typeLabel = TYPE_LABELS[b.briefing_type ?? ''] ?? b.briefing_type ?? 'Agent';

  function exportReport() {
    const html = generateReportHTML({
      content:    b.response_text,
      agentName:  b.agent_name,
      routeType:  b.briefing_type,
      confidence: null,
      evidence:   b.evidence_json,
      orgName:    null,
      timestamp:  b.created_at,
    });
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  return (
    <li className={styles.card} data-open={open ? 'true' : undefined}>
      {/* Card header — always visible */}
      <button
        type="button"
        className={styles.cardToggle}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen(p => !p)}
      >
        <span className={styles.agentIcon} style={{ color }} aria-hidden="true">{icon}</span>
        <span className={styles.cardText}>
          <span className={styles.cardTitle}>
            {b.title}
          </span>
          <span className={styles.cardMeta}>
            <span className={styles.typeTag}>
              <span className={styles.agentDot} style={{ background: color }} aria-hidden="true" />
              {typeLabel}
            </span>
            {b.agent_name && (
              <span>
                {b.agent_name.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            )}
            <span>{timeAgo(b.created_at)}</span>
          </span>
        </span>
        <span className={styles.chevron} aria-hidden="true">▼</span>
      </button>

      {/* Expanded body */}
      {open && (
        <div id={bodyId} className={styles.cardBody}>
          {b.response_text && (
            <p className={styles.response}>
              {b.response_text}
            </p>
          )}

          {b.evidence_json && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className={styles.evidenceToggle}
                aria-expanded={evidenceOpen}
                aria-controls={evidenceOpen ? evidenceId : undefined}
                onClick={() => setEvidenceOpen(p => !p)}
              >
                {evidenceOpen ? '▲ HIDE EVIDENCE' : '▼ VIEW EVIDENCE'}
              </Button>
              {evidenceOpen && <EvidencePanel evidence={b.evidence_json} id={evidenceId} />}
            </>
          )}

          {/* Action row */}
          <div className={styles.actions}>
            <Button size="sm" variant="secondary" onClick={exportReport}>
              <span aria-hidden="true">↗</span> Export report
            </Button>
            <Button size="sm" variant="danger" onClick={() => onDelete(b.id)}>
              <span aria-hidden="true">✕</span> Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function BriefingsClient() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [filter, setFilter]       = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = filter ? `?type=${filter}` : '';
    const res = await fetch(`/api/briefings${params}`);
    if (res.ok) {
      const data = await res.json();
      setBriefings(data.briefings ?? []);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function deleteBriefing(id: string) {
    await fetch(`/api/briefings?id=${id}`, { method: 'DELETE' });
    setBriefings(prev => prev.filter(b => b.id !== id));
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <PageHeader
          eyebrow={<a href="/dashboard" className={styles.back}>← DASHBOARD</a>}
          title="Saved Briefings"
          meta={briefings.length > 0 ? (
            <span className={styles.count}>
              {briefings.length}
            </span>
          ) : undefined}
          description="HLNA agent responses saved for reference and reporting."
        />

        {/* Filter tabs */}
        <div className={styles.filters} role="group" aria-label="Filter briefings by type">
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <button
                key={String(f.key)}
                type="button"
                className={styles.filter}
                aria-pressed={active}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <StateMessage kind="loading" size="page" title="Loading briefings…" />
        ) : briefings.length === 0 ? (
          <StateMessage kind="empty" size="page" title="No saved briefings yet">
            Open HLNA and save any response using the &ldquo;Save briefing&rdquo; button in the evidence panel.
          </StateMessage>
        ) : (
          <ul className={styles.list} aria-label="Saved briefings">
            {briefings.map(b => (
              <BriefingCard key={b.id} b={b} onDelete={deleteBriefing} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
