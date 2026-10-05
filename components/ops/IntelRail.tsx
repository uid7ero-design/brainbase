'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { HlnaOrb } from '@/components/brand/HlnaOrb';
import { Badge } from '@/components/ui/app';
import { useChartPalette, type ChartPalette } from '@/components/ui/app/chartPalette';
import styles from './IntelRail.module.css';

// Phase D2 — the Command intelligence rail on the shared app surface.
// Retained: every section, all sample content, the simulated activity feed
// (new item every 5s), the insight rotation (7s) and the HlnaOrb state
// flash on AI events — behaviour is unchanged. HlnaOrb is a functional
// assistant-state visual (class B) and renders exactly as before; only its
// pulsing drop-shadow wrapper was removed. Removed as decoration (class C):
// header gradient + ambient radial, edge lighting, glowing/blinking dots,
// gradient load bars, the shimmer, and the radar sweep animation. The
// "HLNΛ" wordmark treatment is now plain "HLNA" text. The radar is now a
// static, theme-aware plot (chart palette) instead of a forced-dark screen.
// All figures here are static sample content (see the audit).

const FONT = 'var(--font-inter),"Inter",-apple-system,sans-serif';

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

type Tone = 'danger' | 'warning' | 'success' | 'info' | 'accent' | 'neutral';

const HEALTH: { label: string; value: string; tone: Tone }[] = [
  { label: 'Ingestion API', value: 'OK',       tone: 'success' },
  { label: 'Upload Queue',  value: '0 pending', tone: 'success' },
  { label: 'HLNA Core',     value: 'Active',   tone: 'accent'  },
  { label: 'Fleet Telem.',  value: '16 / 18',  tone: 'warning' },
  { label: 'AI Load',       value: '12%',      tone: 'success' },
  { label: 'Data Sync',     value: '2s ago',   tone: 'success' },
];

// Priority is written next to each task for assistive tech and shown as a
// semantic dot; colour is never the only signal.
const PRIORITY_TONE: Record<'critical' | 'high' | 'medium', Tone> = {
  critical: 'danger',
  high:     'warning',
  medium:   'info',
};

// Activity category is written in each row's meta line; only categories
// that carry meaning get colour (alerts = danger, HLNA/AI = product accent),
// the rest are neutral — no rainbow of category hues.
const ACTIVITY_TONE: Record<ActivityType, Tone> = {
  upload: 'neutral',
  alert:  'danger',
  ai:     'accent',
  fleet:  'neutral',
  route:  'neutral',
  system: 'neutral',
};

function formatAge(s: number) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// ── Mini Radar ─────────────────────────────────────────────────────────────────
// Phase D2 (class C → simplified): a static plot of the same sample
// incident positions on the rail surface, coloured from the JS chart
// palette so it reads in both themes. No sweep, pulses or forced-dark
// "radar screen".

function MiniRadar({ chart }: { chart: ChartPalette }) {
  return (
    <svg viewBox="0 0 120 120" style={{ display: 'block', width: '100%', height: '100%' }} role="img" aria-label="Operational radar: 2 critical and 2 warning incidents, 2 stable points, Metro Area">
      {/* Rings */}
      <circle cx="60" cy="60" r="56" fill="none" stroke={chart.grid} strokeWidth="0.8" />
      <circle cx="60" cy="60" r="42" fill="none" stroke={chart.grid} strokeWidth="0.6" />
      <circle cx="60" cy="60" r="28" fill="none" stroke={chart.grid} strokeWidth="0.6" />
      <circle cx="60" cy="60" r="14" fill="none" stroke={chart.grid} strokeWidth="0.6" />

      {/* Grid lines */}
      <line x1="4"  y1="60" x2="116" y2="60"  stroke={chart.grid} strokeWidth="0.5" />
      <line x1="60" y1="4"  x2="60"  y2="116" stroke={chart.grid} strokeWidth="0.5" />

      {/* Critical incidents */}
      <circle cx="36" cy="28" r="3" fill={chart.danger} />
      <circle cx="44" cy="80" r="3" fill={chart.danger} />

      {/* Warning incidents */}
      <circle cx="78" cy="44" r="2.4" fill={chart.warning} />
      <circle cx="55" cy="36" r="2.2" fill={chart.warning} />

      {/* Stable */}
      <circle cx="84" cy="72" r="2" fill={chart.success} />
      <circle cx="68" cy="88" r="1.8" fill={chart.success} />

      {/* Centre */}
      <circle cx="60" cy="60" r="2" fill={chart.primary} />

      {/* Corner label */}
      <text x="6" y="116" fill={chart.axis} fontSize="6" fontFamily={FONT}>Metro Area</text>
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function IntelRail() {
  const chart = useChartPalette();
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
    <aside className={styles.rail} aria-label="HLNA intelligence">
      {/* ── HLNA CORE HEADER ─────────────────────────────────── */}
      <div className={styles.core}>
        {/* Orb — functional assistant state (idle / thinking), unchanged. */}
        <div style={{ flexShrink: 0 }}>
          <HlnaOrb size={46} state={orbState} speechRef={undefined} style={undefined} />
        </div>

        {/* Identity */}
        <div className={styles.identity}>
          <p className={styles.name}>
            HLNA
            <Badge state="success">Live</Badge>
          </p>
          <div className={styles.stateLine}>
            {orbState === 'thinking' ? 'Processing analysis…' : 'Monitoring operations'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className={styles.bar} aria-hidden="true">
              <div className={styles.barFill} style={{ width: `${orbState === 'thinking' ? 65 : 32}%` }} />
            </div>
            <span className={styles.mono}>
              {orbState === 'thinking' ? '65%' : '32%'} load
            </span>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────── */}
      <div className={styles.body}>

        {/* ── A. LIVE ACTIVITY FEED ──────────────────────────── */}
        <section className={styles.section} aria-labelledby="ir-activity">
          <div className={styles.sectionHeader}>
            <h2 id="ir-activity" className={styles.sectionTitle}>Live Activity</h2>
            <span className={styles.mono}>{activity.length} events</span>
          </div>

          <ul className={styles.list}>
            {activity.map((item) => (
              <li key={item.id} className={`${styles.item} ${styles.tone} ${item.fresh ? styles.fresh : ''}`} data-status={ACTIVITY_TONE[item.type]}>
                <span className={styles.dot} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.itemText}>{item.text}</div>
                  <div className={styles.itemMeta}>
                    {item.type.toUpperCase()} · {formatAge(item.age + tick)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── C. HLNA PULSE INSIGHTS ────────────────────────── */}
        <section className={styles.section} aria-labelledby="ir-pulse">
          <div className={styles.sectionHeader}>
            <h2 id="ir-pulse" className={styles.sectionTitle}>HLNA Pulse</h2>
          </div>
          <div className={styles.pulse}>
            <div className={styles.pulseInner} style={{ opacity: pulseFading ? 0 : 1 }}>
              <p className={styles.pulseText}>
                {insight.text}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className={styles.bar} aria-hidden="true">
                  <div className={styles.barFill} style={{ width: `${insight.conf}%`, transition: 'none' }} />
                </div>
                <span className={styles.mono}>{insight.conf}%<span className={styles.srOnly}> confidence</span></span>
              </div>
              <div className={styles.pips} aria-hidden="true">
                {PULSE_INSIGHTS.map((_, i) => (
                  <span key={i} className={styles.pip} data-active={i === pulseIdx ? '' : undefined} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── B. ACTIVE OPERATIONAL TASKS ───────────────────── */}
        <section className={styles.section} aria-labelledby="ir-tasks">
          <div className={styles.sectionHeader}>
            <h2 id="ir-tasks" className={styles.sectionTitle}>Active Tasks</h2>
            <span className={`${styles.mono} ${styles.tone} ${styles.statusText}`} data-status="danger" style={{ fontWeight: 700 }}>2 critical</span>
          </div>
          <ul className={styles.list}>
            {TASKS.map((task, i) => (
              <li key={i}>
                <Link href={task.href} className={`${styles.taskLink} ${styles.tone}`} data-status={PRIORITY_TONE[task.priority]}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span style={{ flex: 1 }}>
                    <span className={styles.srOnly}>{task.priority} priority: </span>
                    {task.text}
                  </span>
                  <span className={styles.mono}>{task.age}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ── D. SYSTEM HEALTH ──────────────────────────────── */}
        <section className={styles.section} aria-labelledby="ir-health">
          <div className={styles.sectionHeader}>
            <h2 id="ir-health" className={styles.sectionTitle}>System Health</h2>
          </div>
          <dl className={styles.health}>
            {HEALTH.map(h => (
              <div key={h.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <dt className={styles.healthLabel}>{h.label}</dt>
                <dd className={`${styles.healthValue} ${styles.tone}`} data-status={h.tone}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.statusText}>{h.value}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── E. MINI RADAR ─────────────────────────────────── */}
        <section className={styles.section} aria-labelledby="ir-radar">
          <div className={styles.sectionHeader}>
            <h2 id="ir-radar" className={styles.sectionTitle}>Operational Radar</h2>
            <span className={styles.mono}>
              <span className={`${styles.tone} ${styles.statusText}`} data-status="danger">2 critical</span>
              {' · '}
              <span className={`${styles.tone} ${styles.statusText}`} data-status="warning">2 warning</span>
            </span>
          </div>
          <div className={styles.radar}>
            <MiniRadar chart={chart} />
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className={styles.footer}>
          <span>Intelligence v2.4</span>
          <span>Live</span>
        </div>
      </div>
    </aside>
  );
}
