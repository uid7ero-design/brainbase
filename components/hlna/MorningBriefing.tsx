'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';
import { getDeptConfig } from '@/lib/hlna/departmentConfigs';
import { type StructuredBriefing, type Urgency } from '@/lib/hlna/wasteIntelligence';
import { Badge, type SemanticState } from '@/components/ui/semantic';
import { buttonProps } from '@/components/ui/app/Button';
import styles from './MorningBriefing.module.css';

// Visual (remaining visual islands pass): the dark gradient card, grid
// texture, urgency glows, violet chrome and the local Inter stack are
// replaced by app tokens (MorningBriefing.module.css). Urgency now reads
// from the card edge + leading bar (semantic status tokens) and the shared
// Badge; section and metric hues sit on edges/tints with text on
// --text-primary. Fetches, fallbacks and askHlna prompts are unchanged.
const URGENCY_BADGE_STATE: Record<Urgency, SemanticState> = {
  critical: 'error',
  high:     'error',
  medium:   'warning',
  low:      'success',
};

type ApiResponse = {
  greeting: string;
  lines: string[];
  urgentCount: number;
  summary: string;
  hasData: boolean;
  timestamp: string;
};

type WhatChanged = {
  bullets: string[];
  hasData: boolean;
};

function Shimmer() {
  return (
    <div className={styles.card} aria-busy="true">
      <span className="sr-only" role="status">Loading briefing…</span>
      {/* Header shimmer */}
      <div className={styles.skeletonRow} aria-hidden="true">
        <span className={styles.liveDot} />
        <div className={styles.bone} style={{ height: 9, width: 160 }} />
        <div className={styles.spacer} />
        <div className={styles.bone} style={{ height: 9, width: 70 }} />
      </div>
      {/* Metric pills shimmer */}
      <div className={styles.skeletonPills} aria-hidden="true">
        {[1,2,3,4].map(i => (
          <div key={i} className={styles.bone} style={{ height: 32, width: 90 }} />
        ))}
      </div>
      {/* Section shimmers */}
      {[90, 75, 85, 70].map((w, i) => (
        <div key={i} className={styles.bone} style={{ height: 48, width: `${w}%`, marginBottom: 8 }} aria-hidden="true" />
      ))}
    </div>
  );
}

// ── Section block ──────────────────────────────────────────────────────────────
const SECTIONS = [
  { key: 'changed', label: 'WHAT CHANGED',   icon: '↕' },
  { key: 'why',     label: 'WHY IT MATTERS', icon: '◎' },
  { key: 'risk',    label: 'RISK',           icon: '▲' },
  { key: 'action',  label: 'ACTION',         icon: '→' },
] as const;

function SectionBlock({ sKey, content, loading }: { sKey: typeof SECTIONS[number]['key']; content: string; loading?: boolean }) {
  const s = SECTIONS.find(x => x.key === sKey)!;
  return (
    <div className={styles.section} data-section={s.key}>
      <h3 className={styles.sectionHead}>
        <span className={styles.sectionIcon} aria-hidden="true">{s.icon}</span>
        {s.label}
      </h3>
      {loading ? (
        <div className={styles.bone} style={{ height: 12, width: '60%' }} aria-hidden="true" />
      ) : (
        <p className={styles.sectionText}>
          {content}
        </p>
      )}
    </div>
  );
}

// ── Metric pill ────────────────────────────────────────────────────────────────
function MetricPill({ label, value, delta, bad }: { label: string; value: string; delta: string; bad: boolean }) {
  return (
    <li className={styles.metric} data-bad={bad ? 'true' : 'false'}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValues}>
        <span className={styles.metricValue}>{value}</span>
        <span className={styles.metricDelta}>{delta}</span>
        <span className="sr-only">{bad ? ' (needs attention)' : ' (on track)'}</span>
      </div>
    </li>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function MorningBriefing() {
  const [apiData,   setApiData]   = useState<ApiResponse | null>(null);
  const [changed,   setChanged]   = useState<WhatChanged | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [loadingChg,setLoadingChg]= useState(false);
  const [elapsed,   setElapsed]   = useState('');
  const lastUploadRef = useRef<string | null>(null);

  const { fireHelena, setChatOpen, lastUpload, activeDepartment } = useAppStore();
  const deptBriefing = getDeptConfig(activeDepartment).briefing;

  const loadBriefing = useCallback(async () => {
    setLoading(true);
    try {
      const [briefRes, chgRes] = await Promise.all([
        fetch('/api/hlna/briefing',    { method: 'POST' }),
        fetch('/api/hlna/whatchanged', { method: 'POST' }),
      ]);
      if (briefRes.ok) {
        const data: ApiResponse & { debug?: { source: string; reason: string } } = await briefRes.json();
        if (process.env.NODE_ENV === 'development' && data.debug) {
          console.warn('[HLNA] Fallback response active:', data.debug);
        }
        setApiData(data);
      }
      if (chgRes.ok) setChanged(await chgRes.json());
    } catch (err) {
      console.error('[HLNA] loadBriefing failed:', err);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBriefing(); }, [loadBriefing]);

  useEffect(() => {
    if (!lastUpload || lastUpload === lastUploadRef.current) return;
    lastUploadRef.current = lastUpload;
    loadBriefing();
  }, [lastUpload, loadBriefing]);

  // Relative timestamp
  const tsSource = apiData?.timestamp ?? deptBriefing.timestamp;
  useEffect(() => {
    function tick() {
      const secs = Math.floor((Date.now() - new Date(tsSource).getTime()) / 1000);
      if (secs < 60)        setElapsed(`${secs}s ago`);
      else if (secs < 3600) setElapsed(`${Math.floor(secs / 60)}m ago`);
      else                  setElapsed(`${Math.floor(secs / 3600)}h ago`);
    }
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [tsSource]);

  function askHlna(q: string) { fireHelena(q); setChatOpen(true); }

  if (loading) return <Shimmer />;

  // Build display data: prefer real API, fall back to mock
  const hasReal   = apiData?.hasData ?? false;
  const urgency: Urgency = hasReal
    ? (apiData!.urgentCount >= 3 ? 'high' : apiData!.urgentCount > 0 ? 'medium' : 'low')
    : deptBriefing.urgency;
  const urgentCount = hasReal ? apiData!.urgentCount : deptBriefing.urgentCount;
  const metrics     = deptBriefing.metrics;

  let sectionChanged: string;
  let sectionWhy:     string;
  let sectionRisk:    string;
  let sectionAction:  string;

  if (hasReal && changed?.hasData && changed.bullets.length > 0) {
    sectionChanged = changed.bullets.map(b => b.replace(/^(UP|DOWN|STABLE)[:\s]*/i, '')).join(' ');
    sectionWhy     = apiData!.lines.slice(0, 2).join(' ');
    sectionRisk    = urgentCount > 0
      ? `${urgentCount} item${urgentCount > 1 ? 's' : ''} require${urgentCount === 1 ? 's' : ''} attention. ${apiData!.lines.at(-1) ?? ''}`
      : 'No critical thresholds breached at this time.';
    sectionAction  = apiData!.summary || deptBriefing.action;
  } else if (hasReal) {
    sectionChanged = apiData!.lines[0] ?? deptBriefing.changed;
    sectionWhy     = apiData!.lines.slice(1, 3).join(' ') || deptBriefing.why;
    sectionRisk    = urgentCount > 0
      ? `${urgentCount} urgent item${urgentCount > 1 ? 's' : ''} flagged. ${apiData!.lines.at(-1) ?? ''}`
      : 'No critical thresholds breached.';
    sectionAction  = apiData!.summary || deptBriefing.action;
  } else {
    sectionChanged = deptBriefing.changed;
    sectionWhy     = deptBriefing.why;
    sectionRisk    = deptBriefing.risk;
    sectionAction  = deptBriefing.action;
  }

  const deptAlerts = getDeptConfig(activeDepartment).alerts;
  const summaryText = hasReal
    ? `${apiData!.greeting}. ${apiData!.summary}`
    : `${deptBriefing.changed} ${deptBriefing.why} ${deptBriefing.action}`;

  return (
    <div className={styles.card} data-urgency={urgency}>

      {/* Leading bar — colour follows urgency (semantic status token). */}
      <div className={styles.bar} aria-hidden="true" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <span className={styles.liveDot} aria-hidden="true" />
        <h2 className={styles.title}>
          HLNΛ · Operations Briefing
        </h2>
        {!hasReal && (
          <Badge state="inactive" dot={false}>DEMO</Badge>
        )}
        <span className={styles.spacer} />
        {urgentCount > 0 && (
          <Badge state={URGENCY_BADGE_STATE[urgency]}>
            {urgentCount} URGENT
          </Badge>
        )}
        <span className={styles.elapsed}>{elapsed}</span>
        <button
          type="button"
          onClick={loadBriefing}
          title="Refresh briefing"
          aria-label="Refresh briefing"
          className={styles.refresh}
        ><span aria-hidden="true">↻</span></button>
      </div>

      {/* ── Metric pills ────────────────────────────────────────────────── */}
      <ul className={styles.metrics}>
        {metrics.map(m => (
          <MetricPill key={m.label} label={m.label} value={m.value} delta={m.delta} bad={m.bad} />
        ))}
      </ul>

      {/* ── Four sections ────────────────────────────────────────────────── */}
      <div className={styles.sections}>
        <SectionBlock sKey="changed" content={sectionChanged} />
        <SectionBlock sKey="why"     content={sectionWhy}     />
        <SectionBlock sKey="risk"    content={sectionRisk}    />
        <SectionBlock sKey="action"  content={sectionAction}  />
      </div>

      {/* ── CTA row ──────────────────────────────────────────────────────── */}
      <div className={styles.ctas}>
        <ActionBtn
          label="Full Briefing"
          variant="primary"
          onClick={() => askHlna(summaryText + ' Give me a complete executive briefing with all key metrics, risks, and the top 3 actions I should take today.')}
        />
        <ActionBtn
          label="What changed?"
          variant="secondary"
          onClick={() => askHlna('What exactly changed in our waste operations data since last week? Give me a precise comparison of all KPIs.')}
        />
        <ActionBtn
          label={deptAlerts[0] ? deptAlerts[0].label.split('—')[0].trim().split(' ').slice(0, 4).join(' ') : 'Top alert'}
          variant="secondary"
          onClick={() => askHlna(deptAlerts[0]?.command ?? 'What are the top risk items for this department right now?')}
        />
      </div>
    </div>
  );
}

function ActionBtn({ label, variant, onClick }: { label: string; variant: 'primary' | 'secondary'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...buttonProps(variant, 'sm')}
    >
      {label}
    </button>
  );
}
