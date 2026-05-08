'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { HlnaOrb } from '@/components/brand/HlnaOrb';

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';
const MONO = 'var(--font-geist-mono,"Geist Mono",monospace)';

// ── Types ──────────────────────────────────────────────────────────────────────

type ActivityType = 'upload' | 'alert' | 'ai' | 'fleet' | 'route' | 'system';
type ActivityItem = { id: number; type: ActivityType; text: string; age: number; fresh: boolean };

// ── Data ───────────────────────────────────────────────────────────────────────

const ACTIVITY_POOL: { type: ActivityType; text: string }[] = [
  { type: 'ai',     text: 'HLNA briefing regenerated — 3 new insights' },
  { type: 'alert',  text: 'Route 7 flagged — delay exceeds KPI threshold' },
  { type: 'upload', text: 'waste_q2_june.csv processed — 412 records' },
  { type: 'fleet',  text: 'TRK-008 telemetry: fuel burn +18% above baseline' },
  { type: 'route',  text: 'Southern routes resequenced for wet weather' },
  { type: 'system', text: 'Transfer station capacity recalculated — 96%' },
  { type: 'ai',     text: 'Forecast model updated — weather integration applied' },
  { type: 'alert',  text: 'Alert escalated — organics backlog Zone 8' },
  { type: 'upload', text: 'fleet_telematics_may.xlsx imported — 88 vehicles' },
  { type: 'ai',     text: 'Complaint velocity analysis complete' },
  { type: 'route',  text: 'Zone 3 crew reassigned — driver coverage gap' },
  { type: 'fleet',  text: 'Maintenance flag cleared — TRK-011 cleared' },
  { type: 'system', text: 'AI processing load normalised — 12% utilisation' },
  { type: 'alert',  text: 'Weather alert: rainfall expected tonight — 8mm' },
];

const INITIAL_ACTIVITY: ActivityItem[] = [
  { id: 100, type: 'ai',     text: 'HLNA analysis complete — 4 insights surfaced',    age: 4,   fresh: false },
  { id: 101, type: 'system', text: 'Transfer station capacity recalculated — 96%',    age: 22,  fresh: false },
  { id: 102, type: 'alert',  text: 'Route 7 flagged — delay exceeds KPI threshold',   age: 38,  fresh: false },
  { id: 103, type: 'upload', text: 'waste_q2_june.csv processed — 412 records',       age: 74,  fresh: false },
  { id: 104, type: 'fleet',  text: 'TRK-008 telemetry: fuel burn +18%',               age: 130, fresh: false },
];

const PULSE_INSIGHTS = [
  { text: 'Diversion rate trending +1.4% — momentum building',        conf: 88 },
  { text: 'Complaint velocity increasing — correlates Zone 3 staffing', conf: 79 },
  { text: 'Storm risk elevated — 3 routes at weather disruption risk', conf: 92 },
  { text: 'TRK-008 maintenance required within 4 operational days',    conf: 95 },
  { text: 'Organics backlog recovery projected by Thursday',           conf: 74 },
  { text: 'Fuel variance stabilising — TRK-011 optimisation effective', conf: 81 },
];

const TASKS = [
  { priority: 'critical' as const, text: 'Resolve Route 4+7 delays',            href: '/dashboard/waste',  age: '2h' },
  { priority: 'high'     as const, text: 'Review transfer station capacity plan', href: '/dashboard/fleet',  age: '3h' },
  { priority: 'high'     as const, text: 'Address Zone 3 staffing gap',          href: '/dashboard/waste',  age: '4h' },
  { priority: 'medium'   as const, text: 'Complete monthly compliance report',    href: '/reports',          age: '1d' },
  { priority: 'medium'   as const, text: 'Follow up contractor invoices',         href: '/crm',              age: '2d' },
];

const HEALTH = [
  { label: 'Ingestion API', value: 'OK',       color: '#22C55E' },
  { label: 'Upload Queue',  value: '0 pending', color: '#22C55E' },
  { label: 'HLNA Core',     value: 'Active',   color: '#A78BFA' },
  { label: 'Fleet Telem.',  value: '16 / 18',  color: '#F59E0B' },
  { label: 'AI Load',       value: '12%',      color: '#22C55E' },
  { label: 'Data Sync',     value: '2s ago',   color: '#22C55E' },
];

const PRIORITY_COLOR = {
  critical: '#EF4444',
  high:     '#F59E0B',
  medium:   '#60A5FA',
};

const ACTIVITY_COLOR: Record<ActivityType, string> = {
  upload: '#60A5FA',
  alert:  '#EF4444',
  ai:     '#A78BFA',
  fleet:  '#F59E0B',
  route:  '#34D399',
  system: '#94A3B8',
};

function formatAge(s: number) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// ── Mini Radar ─────────────────────────────────────────────────────────────────

function MiniRadar() {
  return (
    <svg viewBox="0 0 120 120" style={{ display: 'block', width: '100%', height: '100%' }}>
      <defs>
        <radialGradient id="ir-radar-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(20,10,40,.60)" />
          <stop offset="100%" stopColor="rgba(4,5,9,.10)" />
        </radialGradient>
      </defs>

      {/* Base */}
      <circle cx="60" cy="60" r="56" fill="url(#ir-radar-bg)" />
      <circle cx="60" cy="60" r="56" fill="none" stroke="rgba(139,92,246,.12)" strokeWidth="0.6" />

      {/* Rings */}
      <circle cx="60" cy="60" r="42" fill="none" stroke="rgba(139,92,246,.08)" strokeWidth="0.5" />
      <circle cx="60" cy="60" r="28" fill="none" stroke="rgba(139,92,246,.09)" strokeWidth="0.5" />
      <circle cx="60" cy="60" r="14" fill="none" stroke="rgba(139,92,246,.12)" strokeWidth="0.5" />

      {/* Grid lines */}
      <line x1="4"  y1="60" x2="116" y2="60"  stroke="rgba(255,255,255,.035)" strokeWidth="0.5" />
      <line x1="60" y1="4"  x2="60"  y2="116" stroke="rgba(255,255,255,.035)" strokeWidth="0.5" />
      <line x1="20" y1="20" x2="100" y2="100" stroke="rgba(255,255,255,.020)" strokeWidth="0.5" />
      <line x1="100" y1="20" x2="20" y2="100" stroke="rgba(255,255,255,.020)" strokeWidth="0.5" />

      {/* Sweep trailing */}
      <line x1="60" y1="60" x2="102" y2="60" stroke="rgba(139,92,246,.06)" strokeWidth="5" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="-25 60 60" to="335 60 60" dur="4s" repeatCount="indefinite" />
      </line>
      <line x1="60" y1="60" x2="102" y2="60" stroke="rgba(139,92,246,.12)" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="-12 60 60" to="348 60 60" dur="4s" repeatCount="indefinite" />
      </line>

      {/* Main sweep arm */}
      <line x1="60" y1="60" x2="102" y2="60" stroke="rgba(139,92,246,.65)" strokeWidth="1.2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="4s" repeatCount="indefinite" />
      </line>

      {/* Critical incidents — pulsing red */}
      <circle cx="36" cy="28" r="2.5" fill="#EF4444" opacity="0.90">
        <animate attributeName="r" values="2;3.8;2" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <circle cx="36" cy="28" r="6" fill="none" stroke="#EF4444" strokeWidth="0.6" opacity="0.3">
        <animate attributeName="r"       values="4;10;4"   dur="2.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".4;0;.4"  dur="2.2s" repeatCount="indefinite" />
      </circle>

      <circle cx="44" cy="80" r="2.5" fill="#EF4444" opacity="0.88">
        <animate attributeName="r" values="2;3.5;2" dur="2.1s" repeatCount="indefinite" />
      </circle>
      <circle cx="44" cy="80" r="6" fill="none" stroke="#EF4444" strokeWidth="0.6" opacity="0.3">
        <animate attributeName="r"       values="4;10;4"   dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".4;0;.4"  dur="2.6s" repeatCount="indefinite" />
      </circle>

      {/* Warning incidents */}
      <circle cx="78" cy="44" r="2"   fill="#F59E0B" opacity="0.80" />
      <circle cx="55" cy="36" r="1.8" fill="#F59E0B" opacity="0.70" />

      {/* Stable */}
      <circle cx="84" cy="72" r="1.8" fill="#22C55E" opacity="0.65" />
      <circle cx="68" cy="88" r="1.5" fill="#22C55E" opacity="0.55" />

      {/* Centre dot */}
      <circle cx="60" cy="60" r="2.5" fill="rgba(139,92,246,.70)" />
      <circle cx="60" cy="60" r="1.2" fill="#A78BFA" />

      {/* Corner label */}
      <text x="6" y="116" fill="rgba(255,255,255,.18)" fontSize="5.5" fontFamily={FONT}>Metro Area</text>
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function IntelRail() {
  const [activity, setActivity]       = useState<ActivityItem[]>(INITIAL_ACTIVITY);
  const [pulseIdx, setPulseIdx]       = useState(0);
  const [pulseFading, setPulseFading] = useState(false);
  const [orbState, setOrbState]       = useState<'idle' | 'thinking'>('idle');
  const [tick, setTick]               = useState(0);
  const nextId = useRef(200);
  const poolIdx = useRef(0);

  // Age counter — increment all timestamps every second
  useEffect(() => {
    const id = setInterval(() => setTick(p => p + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Add new activity item every 5s
  useEffect(() => {
    const id = setInterval(() => {
      const pool = ACTIVITY_POOL[poolIdx.current % ACTIVITY_POOL.length];
      poolIdx.current++;
      const newItem: ActivityItem = { id: nextId.current++, type: pool.type, text: pool.text, age: 0, fresh: true };
      setActivity(prev => {
        const updated = [newItem, ...prev.slice(0, 9)];
        return updated;
      });
      // Briefly flash orb on AI events
      if (pool.type === 'ai') {
        setOrbState('thinking');
        setTimeout(() => setOrbState('idle'), 2200);
      }
      // Remove fresh flag after animation
      setTimeout(() => {
        setActivity(p => p.map(i => i.id === newItem.id ? { ...i, fresh: false } : i));
      }, 600);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Cycle HLNA pulse insights every 7s
  useEffect(() => {
    const id = setInterval(() => {
      setPulseFading(true);
      setTimeout(() => {
        setPulseIdx(p => (p + 1) % PULSE_INSIGHTS.length);
        setPulseFading(false);
      }, 380);
    }, 7000);
    return () => clearInterval(id);
  }, []);

  const insight = PULSE_INSIGHTS[pulseIdx];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes ir-slide { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
        @keyframes ir-blink  { 0%,100%{opacity:1} 50%{opacity:.28} }
        @keyframes ir-glow   { 0%,100%{filter:drop-shadow(0 0 6px rgba(139,92,246,.5))} 50%{filter:drop-shadow(0 0 16px rgba(139,92,246,.80))} }
        @keyframes ir-pulse  { 0%,100%{box-shadow:0 0 5px currentColor} 50%{box-shadow:0 0 12px currentColor} }
        @keyframes ir-shimmer{ 0%{opacity:.55} 50%{opacity:1} 100%{opacity:.55} }
        @keyframes ir-flow   { from{transform:translateY(0)} to{transform:translateY(-2px)} }
        .ir-fresh { animation: ir-slide .35s ease forwards }
      `}} />

      <aside style={{
        width: 260, flexShrink: 0,
        height: '100%', display: 'flex', flexDirection: 'column',
        background: 'rgba(4,5,9,.98)',
        borderLeft: '1px solid rgba(255,255,255,.055)',
        fontFamily: FONT,
        position: 'relative', zIndex: 8, overflow: 'hidden',
        boxShadow: 'inset 1px 0 0 rgba(139,92,246,.06)',
      }}>
        {/* Edge light */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: 1, height: '100%', background: 'linear-gradient(180deg,transparent 0%,rgba(139,92,246,.14) 25%,rgba(139,92,246,.07) 75%,transparent 100%)', pointerEvents: 'none', zIndex: 1 }} />

        {/* ── HLNA CORE HEADER ─────────────────────────────────── */}
        <div style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(139,92,246,.10)',
          background: 'linear-gradient(180deg,rgba(109,40,217,.09) 0%,rgba(4,5,9,.0) 100%)',
          flexShrink: 0,
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Ambient glow behind orb */}
          <div style={{ position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)', width: 120, height: 80, borderRadius: '50%', background: 'radial-gradient(ellipse,rgba(139,92,246,.18) 0%,transparent 70%)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
            {/* Orb */}
            <div style={{ flexShrink: 0, animation: 'ir-glow 4s ease-in-out infinite' }}>
              <HlnaOrb size={46} state={orbState} speechRef={undefined} style={undefined} />
            </div>

            {/* Identity */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.18em', color: 'rgba(255,255,255,.80)', textTransform: 'uppercase' }}>
                  HLN<span style={{ color: '#A78BFA' }}>Λ</span>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,.07)', border: '1px solid rgba(34,197,94,.16)' }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 4px #22C55E', animation: 'ir-blink 2.4s ease-in-out infinite' }} />
                  <span style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(34,197,94,.80)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Live</span>
                </div>
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,.28)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                {orbState === 'thinking' ? 'Processing analysis…' : 'Monitoring operations'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ height: 2, flex: 1, borderRadius: 1, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${orbState === 'thinking' ? 65 : 32}%`, background: 'linear-gradient(90deg,#6D28D9,#A78BFA)', borderRadius: 1, transition: 'width 1.5s ease', animation: orbState === 'thinking' ? 'ir-shimmer 1.2s ease-in-out infinite' : 'none' }} />
                </div>
                <span style={{ fontSize: 8.5, color: 'rgba(167,139,250,.45)', fontFamily: MONO, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>
                  {orbState === 'thinking' ? '65%' : '32%'} load
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {/* ── A. LIVE ACTIVITY FEED ──────────────────────────── */}
          <section>
            <div style={{ padding: '9px 14px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(4,5,9,.98)', zIndex: 2, borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 5px #22C55E', animation: 'ir-blink 1.8s ease-in-out infinite' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>Live Activity</span>
              </div>
              <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,.18)', fontFamily: MONO }}>{activity.length} events</span>
            </div>

            <div style={{ padding: '6px 0' }}>
              {activity.map((item) => {
                const color = ACTIVITY_COLOR[item.type];
                const ageDisplay = formatAge(item.age + tick * 0);
                return (
                  <div key={item.id} className={item.fresh ? 'ir-fresh' : ''} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '5px 14px',
                    borderBottom: '1px solid rgba(255,255,255,.025)',
                    transition: 'background .2s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.025)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}`, flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, color: 'rgba(230,237,243,.65)', lineHeight: 1.45, wordBreak: 'break-word' }}>{item.text}</div>
                      <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,.20)', fontFamily: MONO, marginTop: 2, letterSpacing: '.02em' }}>
                        {item.type.toUpperCase()} · {formatAge(item.age + tick)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── C. HLNA PULSE INSIGHTS ────────────────────────── */}
          <section style={{ borderTop: '1px solid rgba(255,255,255,.045)' }}>
            <div style={{ padding: '9px 14px 7px', display: 'flex', alignItems: 'center', gap: 5, borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,.65)" strokeWidth="2" strokeLinecap="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>HLNΛ Pulse</span>
            </div>
            <div style={{ padding: '12px 14px', minHeight: 80 }}>
              <div style={{
                opacity: pulseFading ? 0 : 1,
                transform: pulseFading ? 'translateY(4px)' : 'none',
                transition: 'opacity .35s ease, transform .35s ease',
              }}>
                <div style={{ fontSize: 11, lineHeight: 1.6, color: 'rgba(230,237,243,.72)', marginBottom: 8 }}>
                  {insight.text}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ height: 2, flex: 1, borderRadius: 1, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${insight.conf}%`, borderRadius: 1, background: 'linear-gradient(90deg,#6D28D9,#A78BFA)' }} />
                  </div>
                  <span style={{ fontSize: 8.5, color: 'rgba(167,139,250,.55)', fontFamily: MONO }}>{insight.conf}%</span>
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  {PULSE_INSIGHTS.map((_, i) => (
                    <div key={i} style={{ width: i === pulseIdx ? 14 : 4, height: 2, borderRadius: 1, background: i === pulseIdx ? '#A78BFA' : 'rgba(255,255,255,.12)', transition: 'width .3s, background .3s' }} />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── B. ACTIVE OPERATIONAL TASKS ───────────────────── */}
          <section style={{ borderTop: '1px solid rgba(255,255,255,.045)' }}>
            <div style={{ padding: '9px 14px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#F59E0B', boxShadow: '0 0 5px #F59E0B', animation: 'ir-blink 3s ease-in-out infinite' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>Active Tasks</span>
              </div>
              <span style={{ fontSize: 8.5, color: 'rgba(239,68,68,.55)', fontFamily: MONO, fontWeight: 700 }}>2 critical</span>
            </div>
            <div style={{ padding: '6px 0' }}>
              {TASKS.map((task, i) => {
                const color = PRIORITY_COLOR[task.priority];
                return (
                  <Link key={i} href={task.href} style={{ display: 'block', textDecoration: 'none' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
                      borderBottom: '1px solid rgba(255,255,255,.025)',
                      transition: 'background .15s',
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}`, flexShrink: 0 }} />
                      <span style={{ fontSize: 10.5, color: 'rgba(230,237,243,.62)', flex: 1, lineHeight: 1.4 }}>{task.text}</span>
                      <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,.22)', fontFamily: MONO, whiteSpace: 'nowrap' }}>{task.age}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* ── D. SYSTEM HEALTH ──────────────────────────────── */}
          <section style={{ borderTop: '1px solid rgba(255,255,255,.045)' }}>
            <div style={{ padding: '9px 14px 7px', display: 'flex', alignItems: 'center', gap: 5, borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,.65)" strokeWidth="2" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>System Health</span>
            </div>
            <div style={{ padding: '8px 14px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px' }}>
              {HEALTH.map(h => (
                <div key={h.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,.22)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{h.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: h.color, boxShadow: `0 0 4px ${h.color}`, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: h.color, fontFamily: MONO }}>{h.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── E. MINI RADAR ─────────────────────────────────── */}
          <section style={{ borderTop: '1px solid rgba(255,255,255,.045)' }}>
            <div style={{ padding: '9px 14px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,.65)" strokeWidth="2" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.30)', textTransform: 'uppercase' }}>Operational Radar</span>
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                {[{ c: '#EF4444', n: '2' }, { c: '#F59E0B', n: '2' }].map(({ c, n }) => (
                  <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <div style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: c }} />
                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,.25)' }}>{n}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '8px 20px 14px', height: 140 }}>
              <MiniRadar />
            </div>
          </section>

          {/* ── Footer ─────────────────────────────────────────── */}
          <div style={{ padding: '8px 14px 10px', borderTop: '1px solid rgba(255,255,255,.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,.18)', letterSpacing: '.04em' }}>Intelligence v2.4</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: '#22C55E', animation: 'ir-blink 2.4s ease-in-out infinite' }} />
              <span style={{ fontSize: 8.5, color: 'rgba(34,197,94,.50)', letterSpacing: '.04em' }}>Live</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
