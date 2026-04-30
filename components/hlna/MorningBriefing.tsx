'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/lib/state/useAppStore';
import { getDeptConfig } from '@/lib/hlna/departmentConfigs';
import { type StructuredBriefing, type Urgency } from '@/lib/hlna/wasteIntelligence';

const FONT = "var(--font-inter), -apple-system, sans-serif";

// ── Colour maps ────────────────────────────────────────────────────────────────
const URGENCY_BORDER: Record<Urgency, string> = {
  critical: 'rgba(251,113,133,.50)',
  high:     'rgba(251,113,133,.32)',
  medium:   'rgba(167,139,250,.28)',
  low:      'rgba(167,139,250,.16)',
};
const URGENCY_GLOW: Record<Urgency, string> = {
  critical: '0 0 48px rgba(251,113,133,.14), 0 0 80px rgba(251,113,133,.06)',
  high:     '0 0 36px rgba(251,113,133,.09), 0 0 60px rgba(124,58,237,.06)',
  medium:   '0 0 28px rgba(124,58,237,.08)',
  low:      '0 0 20px rgba(124,58,237,.05)',
};
const URGENCY_BADGE_BG: Record<Urgency, string> = {
  critical: 'rgba(251,113,133,.18)',
  high:     'rgba(251,113,133,.12)',
  medium:   'rgba(251,191,36,.10)',
  low:      'rgba(52,211,153,.10)',
};
const URGENCY_BADGE_COLOR: Record<Urgency, string> = {
  critical: '#FCA5A5',
  high:     '#FB7185',
  medium:   '#FBBF24',
  low:      '#34D399',
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
    <div style={{
      background: 'linear-gradient(145deg, rgba(8,6,20,.97) 0%, rgba(14,10,28,.95) 100%)',
      border: '1px solid rgba(167,139,250,.18)',
      borderRadius: 16, padding: '20px 24px',
      boxShadow: '0 0 28px rgba(124,58,237,.07)',
    }}>
      {/* Header shimmer */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(167,139,250,.35)', animation: 'agentPulse 1.4s ease-in-out infinite' }} />
        <div style={{ height: 9, width: 160, borderRadius: 4, background: 'rgba(255,255,255,.06)' }} />
        <div style={{ flex: 1 }} />
        <div style={{ height: 9, width: 70, borderRadius: 4, background: 'rgba(255,255,255,.04)' }} />
      </div>
      {/* Metric pills shimmer */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ height: 32, width: 90, borderRadius: 8, background: 'rgba(255,255,255,.04)' }} />
        ))}
      </div>
      {/* Section shimmers */}
      {[90, 75, 85, 70].map((w, i) => (
        <div key={i} style={{ height: 48, width: `${w}%`, borderRadius: 8, background: 'rgba(255,255,255,.03)', marginBottom: 8 }} />
      ))}
    </div>
  );
}

// ── Section block ──────────────────────────────────────────────────────────────
const SECTIONS = [
  { key: 'changed', label: 'WHAT CHANGED', dot: '#38BDF8', dotGlow: 'rgba(56,189,248,.35)', icon: '↕',  iconColor: '#38BDF8', rowBg: 'rgba(56,189,248,.03)',  rowBorder: 'rgba(56,189,248,.10)' },
  { key: 'why',     label: 'WHY IT MATTERS',dot:'#A78BFA', dotGlow: 'rgba(167,139,250,.35)', icon: '◎', iconColor: '#A78BFA', rowBg: 'rgba(124,58,237,.04)',   rowBorder: 'rgba(124,58,237,.12)' },
  { key: 'risk',    label: 'RISK',          dot: '#FB7185', dotGlow: 'rgba(251,113,133,.35)', icon: '▲', iconColor: '#FB7185', rowBg: 'rgba(251,113,133,.04)',  rowBorder: 'rgba(251,113,133,.14)' },
  { key: 'action',  label: 'ACTION',        dot: '#34D399', dotGlow: 'rgba(52,211,153,.35)',  icon: '→', iconColor: '#34D399', rowBg: 'rgba(52,211,153,.04)',   rowBorder: 'rgba(52,211,153,.12)' },
] as const;

function SectionBlock({ sKey, content, loading }: { sKey: typeof SECTIONS[number]['key']; content: string; loading?: boolean }) {
  const s = SECTIONS.find(x => x.key === sKey)!;
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 9,
      background: s.rowBg, border: `1px solid ${s.rowBorder}`,
      display: 'flex', gap: 11, alignItems: 'flex-start',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 2, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: s.iconColor, lineHeight: 1 }}>{s.icon}</span>
        <span style={{
          fontSize: 7, fontWeight: 800, letterSpacing: '.12em', color: s.iconColor,
          textTransform: 'uppercase', writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          opacity: 0.7,
        }}>{s.label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {loading ? (
          <div style={{ height: 12, width: '60%', borderRadius: 4, background: 'rgba(255,255,255,.06)', animation: 'agentPulse 1.4s ease-in-out infinite' }} />
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(230,237,243,.85)', lineHeight: 1.6, fontFamily: FONT }}>
            {content}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Metric pill ────────────────────────────────────────────────────────────────
function MetricPill({ label, value, delta, bad }: { label: string; value: string; delta: string; bad: boolean }) {
  const color = bad ? '#FB7185' : '#34D399';
  const bg    = bad ? 'rgba(251,113,133,.06)' : 'rgba(52,211,153,.06)';
  const border= bad ? 'rgba(251,113,133,.20)' : 'rgba(52,211,153,.18)';
  return (
    <div style={{ padding: '6px 12px', borderRadius: 8, background: bg, border: `1px solid ${border}`, flexShrink: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em', color: 'rgba(255,255,255,.35)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#F4F4F5', letterSpacing: '-0.02em' }}>{value}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color }}>{delta}</span>
      </div>
    </div>
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
      if (briefRes.ok) setApiData(await briefRes.json());
      if (chgRes.ok)   setChanged(await chgRes.json());
    } catch { /* silent */ }
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
    <div style={{
      background: 'linear-gradient(145deg, rgba(8,6,20,.97) 0%, rgba(14,10,28,.95) 100%)',
      border: `1px solid ${URGENCY_BORDER[urgency]}`,
      borderRadius: 16,
      padding: '20px 24px',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: FONT,
      boxShadow: URGENCY_GLOW[urgency],
      transition: 'border-color .4s, box-shadow .4s',
    }}>

      {/* Left accent bar — colour shifts with urgency */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: urgency === 'critical' || urgency === 'high'
          ? 'linear-gradient(180deg, #FB7185 0%, #A78BFA 60%, #38BDF8 100%)'
          : 'linear-gradient(180deg, #A78BFA 0%, #38BDF8 100%)',
        borderRadius: '16px 0 0 16px',
      }} />

      {/* Subtle background grid */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 16, pointerEvents: 'none', opacity: 0.025,
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,.5) 0px, rgba(255,255,255,.5) 1px, transparent 1px, transparent 32px), repeating-linear-gradient(90deg, rgba(255,255,255,.5) 0px, rgba(255,255,255,.5) 1px, transparent 1px, transparent 48px)',
      }} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, paddingLeft: 8 }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%', background: '#A78BFA',
          boxShadow: '0 0 8px rgba(167,139,250,.70)',
          animation: 'agentPulse 2s ease-in-out infinite',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', color: 'rgba(167,139,250,.90)', textTransform: 'uppercase' }}>
          HLNΛ · Operations Briefing
        </span>
        {!hasReal && (
          <span style={{ fontSize: 8, padding: '2px 7px', borderRadius: 4, background: 'rgba(255,255,255,.05)', color: 'rgba(255,255,255,.25)', letterSpacing: '.06em', fontWeight: 600 }}>
            DEMO
          </span>
        )}
        <span style={{ flex: 1 }} />
        {urgentCount > 0 && (
          <span style={{
            padding: '3px 9px', borderRadius: 20, fontSize: 9, fontWeight: 800,
            background: URGENCY_BADGE_BG[urgency],
            border: `1px solid ${URGENCY_BORDER[urgency]}`,
            color: URGENCY_BADGE_COLOR[urgency], letterSpacing: '.08em',
            textTransform: 'uppercase',
            animation: urgency === 'critical' ? 'agentPulse 1.2s ease-in-out infinite' : undefined,
          }}>
            {urgentCount} URGENT
          </span>
        )}
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,.22)', letterSpacing: '.04em' }}>{elapsed}</span>
        <button
          onClick={loadBriefing}
          title="Refresh briefing"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.22)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={e => { e.currentTarget.style.color = 'rgba(167,139,250,.70)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,.22)'; }}
        >↻</button>
      </div>

      {/* ── Metric pills ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, paddingLeft: 8, flexWrap: 'wrap' }}>
        {metrics.map(m => (
          <MetricPill key={m.label} label={m.label} value={m.value} delta={m.delta} bad={m.bad} />
        ))}
      </div>

      {/* ── Four sections ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <SectionBlock sKey="changed" content={sectionChanged} />
        <SectionBlock sKey="why"     content={sectionWhy}     />
        <SectionBlock sKey="risk"    content={sectionRisk}    />
        <SectionBlock sKey="action"  content={sectionAction}  />
      </div>

      {/* ── CTA row ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, paddingLeft: 8 }}>
        <ActionBtn
          label="Full Briefing"
          color="#C4B5FD"
          bg="rgba(124,58,237,.14)"
          border="rgba(124,58,237,.32)"
          onClick={() => askHlna(summaryText + ' Give me a complete executive briefing with all key metrics, risks, and the top 3 actions I should take today.')}
        />
        <ActionBtn
          label="What changed?"
          color="#7DD3FC"
          bg="rgba(56,189,248,.08)"
          border="rgba(56,189,248,.22)"
          onClick={() => askHlna('What exactly changed in our waste operations data since last week? Give me a precise comparison of all KPIs.')}
        />
        <ActionBtn
          label={deptAlerts[0] ? deptAlerts[0].label.split('—')[0].trim().split(' ').slice(0, 4).join(' ') : 'Top alert'}
          color="#FCA5A5"
          bg="rgba(251,113,133,.08)"
          border="rgba(251,113,133,.22)"
          onClick={() => askHlna(deptAlerts[0]?.command ?? 'What are the top risk items for this department right now?')}
        />
      </div>
    </div>
  );
}

function ActionBtn({ label, color, bg, border, onClick }: { label: string; color: string; bg: string; border: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 7, fontSize: 10, fontWeight: 700,
        background: bg, border: `1px solid ${border}`,
        color, cursor: 'pointer', letterSpacing: '.06em',
        transition: 'all .18s', fontFamily: FONT, textTransform: 'uppercase',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
    >
      {label}
    </button>
  );
}
