'use client';
import Link from 'next/link';
import ServiceTimeline from '../../components/ServiceTimeline';
import type { PropertyData, VerificationScenario } from './page';
import type { VerificationResult } from '@/lib/wste/types';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#07080B';
const TEAL = '#2DD4BF';

const STATUS_META: Record<string, { label: string; bg: string; border: string; color: string; dot: string }> = {
  verified:           { label: 'Verified',           bg: 'rgba(34,197,94,.12)',   border: 'rgba(34,197,94,.28)',   color: '#4ade80', dot: '#22c55e' },
  likely_completed:   { label: 'Likely Completed',   bg: 'rgba(45,212,191,.10)',  border: 'rgba(45,212,191,.25)',  color: '#2DD4BF', dot: '#14b8a6' },
  likely_missed:      { label: 'Likely Missed',      bg: 'rgba(239,68,68,.12)',   border: 'rgba(239,68,68,.28)',   color: '#f87171', dot: '#ef4444' },
  no_evidence:        { label: 'No Evidence',        bg: 'rgba(245,158,11,.12)',  border: 'rgba(245,158,11,.28)',  color: '#fbbf24', dot: '#f59e0b' },
  exception_recorded: { label: 'Exception Recorded', bg: 'rgba(251,146,60,.12)',  border: 'rgba(251,146,60,.28)',  color: '#fb923c', dot: '#f97316' },
  no_coverage:        { label: 'No Coverage',        bg: 'rgba(148,163,184,.08)', border: 'rgba(148,163,184,.20)', color: '#94a3b8', dot: '#64748b' },
  not_applicable:     { label: 'N/A',                bg: 'rgba(100,116,139,.08)', border: 'rgba(100,116,139,.18)', color: '#64748b', dot: '#475569' },
};

const FALLBACK_META = STATUS_META['no_evidence'];

// ─── GPS Evidence Map ─────────────────────────────────────────────────────────

function GPSMap({ scenario, status }: { scenario: VerificationScenario; status: string }) {
  const accent = status === 'verified' ? '#22c55e'
    : status === 'likely_missed' ? '#ef4444'
    : status === 'exception_recorded' ? '#f97316'
    : status === 'likely_completed' ? '#14b8a6'
    : '#f59e0b';

  if (scenario === 'route_pass') return (
    <svg viewBox="0 0 640 200" width="100%" style={{ display: 'block', borderRadius: '0 0 12px 12px' }}>
      <rect width="640" height="200" fill="#07080B"/>
      <pattern id="g1" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="0.5"/></pattern>
      <rect width="640" height="200" fill="url(#g1)"/>
      <rect x="40" y="20" width="60" height="44" rx="2" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.05)" strokeWidth="0.5"/>
      <rect x="130" y="28" width="80" height="36" rx="2" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.05)" strokeWidth="0.5"/>
      <rect x="250" y="18" width="55" height="50" rx="2" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.05)" strokeWidth="0.5"/>
      <rect x="360" y="24" width="70" height="40" rx="2" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.05)" strokeWidth="0.5"/>
      <rect x="490" y="20" width="55" height="46" rx="2" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.05)" strokeWidth="0.5"/>
      <rect x="0" y="80" width="640" height="24" fill="rgba(255,255,255,.035)"/>
      <line x1="0" y1="92" x2="640" y2="92" stroke="rgba(255,255,255,.07)" strokeWidth="0.5" strokeDasharray="18 12"/>
      <text x="14" y="77" fontSize="8" fill="rgba(255,255,255,.22)" fontFamily="sans-serif" letterSpacing="0.05em">AYERS AVE</text>
      <line x1="290" y1="104" x2="290" y2="150" stroke="rgba(255,255,255,.08)" strokeWidth="1" strokeDasharray="4 4"/>
      <rect x="264" y="150" width="52" height="38" rx="3" fill="rgba(45,212,191,.06)" stroke="rgba(45,212,191,.25)" strokeWidth="1"/>
      <path d="M 267,162 L 290,150 L 313,162" fill="none" stroke="rgba(45,212,191,.4)" strokeWidth="1"/>
      <text x="290" y="178" fontSize="8" textAnchor="middle" fill="rgba(45,212,191,.7)" fontFamily="sans-serif">PROPERTY</text>
      <circle cx="290" cy="88" r="22" fill="rgba(34,197,94,.06)" stroke="rgba(34,197,94,.2)" strokeWidth="1" strokeDasharray="3 2"/>
      <path d="M 0,90 C 80,88 160,87 240,87 S 340,88 420,89 S 520,91 640,93" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="1.5"/>
      {[40,110,180,240,290,350,420,500,580].map((x, i) => {
        const y=[90,89,88,88,87,88,89,90,92][i]; const near=i===4;
        return <g key={x}><circle cx={x} cy={y} r={near?6:3.5} fill={near?accent:'rgba(255,255,255,.28)'}/>{near&&<circle cx={x} cy={y} r={14} fill="none" stroke={accent} strokeWidth="1" opacity="0.35"/>}</g>;
      })}
      <line x1="290" y1="87" x2="290" y2="150" stroke={accent} strokeWidth="1" strokeDasharray="3 3" opacity="0.7"/>
      <rect x="295" y="106" width="28" height="14" rx="3" fill="rgba(7,8,11,.9)" stroke={accent} strokeWidth="0.5"/>
      <text x="309" y="117" fontSize="8" textAnchor="middle" fill={accent} fontFamily="sans-serif" fontWeight="700">7m</text>
      <rect x="260" y="68" width="60" height="14" rx="3" fill="rgba(34,197,94,.14)" stroke="rgba(34,197,94,.3)" strokeWidth="0.5"/>
      <text x="290" y="79" textAnchor="middle" fontSize="8" fill="#4ade80" fontFamily="sans-serif" fontWeight="600">09:12:44 ✓</text>
      <text x="614" y="24" fontSize="8" fill="rgba(255,255,255,.22)" fontFamily="sans-serif" textAnchor="middle">N ↑</text>
      <line x1="14" y1="188" x2="64" y2="188" stroke="rgba(255,255,255,.2)" strokeWidth="1"/>
      <text x="39" y="197" fontSize="7" textAnchor="middle" fill="rgba(255,255,255,.25)" fontFamily="sans-serif">50m</text>
    </svg>
  );

  if (scenario === 'route_bypass') return (
    <svg viewBox="0 0 640 200" width="100%" style={{ display: 'block', borderRadius: '0 0 12px 12px' }}>
      <rect width="640" height="200" fill="#07080B"/>
      <pattern id="g2" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="0.5"/></pattern>
      <rect width="640" height="200" fill="url(#g2)"/>
      <rect x="0" y="38" width="640" height="20" fill="rgba(255,255,255,.025)"/>
      <line x1="0" y1="48" x2="640" y2="48" stroke="rgba(255,255,255,.05)" strokeWidth="0.5" strokeDasharray="18 12"/>
      <text x="14" y="34" fontSize="8" fill="rgba(255,255,255,.20)" fontFamily="sans-serif">PORTRUSH RD</text>
      <rect x="0" y="118" width="640" height="20" fill="rgba(255,255,255,.02)"/>
      <text x="14" y="115" fontSize="8" fill="rgba(255,255,255,.20)" fontFamily="sans-serif">EDMUND AVE / VICTORIA RD</text>
      <rect x="300" y="56" width="18" height="64" fill="rgba(255,255,255,.015)"/>
      <rect x="160" y="144" width="52" height="36" rx="3" fill="rgba(255,255,255,.03)" stroke="rgba(239,68,68,.22)" strokeWidth="1"/>
      <path d="M 163,154 L 186,144 L 209,154" fill="none" stroke="rgba(239,68,68,.3)" strokeWidth="1"/>
      <text x="186" y="172" fontSize="8" textAnchor="middle" fill="rgba(239,68,68,.6)" fontFamily="sans-serif">PROPERTY</text>
      <path d="M 0,47 C 80,46 160,46 230,46 S 310,47 400,48 S 520,49 640,50" fill="none" stroke="rgba(255,255,255,.20)" strokeWidth="1.5"/>
      {[40,110,185,255,330,410,490,570].map((x,i)=><circle key={x} cx={x} cy={[48,47,47,47,47,48,49,50][i]} r="3.5" fill="rgba(255,255,255,.30)"/>)}
      <circle cx="310" cy="48" r="5.5" fill={accent} opacity="0.8"/>
      <circle cx="310" cy="48" r="12" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.3"/>
      <line x1="310" y1="58" x2="210" y2="138" stroke={accent} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5"/>
      <rect x="244" y="94" width="36" height="14" rx="3" fill="rgba(7,8,11,.9)" stroke={accent} strokeWidth="0.5"/>
      <text x="262" y="105" fontSize="8" textAnchor="middle" fill={accent} fontFamily="sans-serif" fontWeight="700">83–112m</text>
      <circle cx="186" cy="152" r="28" fill="rgba(239,68,68,.04)" stroke="rgba(239,68,68,.15)" strokeWidth="0.8" strokeDasharray="3 3"/>
      <rect x="142" y="108" width="80" height="14" rx="3" fill="rgba(239,68,68,.12)" stroke="rgba(239,68,68,.28)" strokeWidth="0.5"/>
      <text x="182" y="119" textAnchor="middle" fontSize="7.5" fill="#f87171" fontFamily="sans-serif" fontWeight="700">NO PASS RECORDED</text>
      <text x="614" y="24" fontSize="8" fill="rgba(255,255,255,.22)" fontFamily="sans-serif" textAnchor="middle">N ↑</text>
    </svg>
  );

  if (scenario === 'gps_gap') return (
    <svg viewBox="0 0 640 200" width="100%" style={{ display: 'block', borderRadius: '0 0 12px 12px' }}>
      <rect width="640" height="200" fill="#07080B"/>
      <pattern id="g3" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,.04)" strokeWidth="0.5"/></pattern>
      <rect width="640" height="200" fill="url(#g3)"/>
      <rect x="0" y="80" width="640" height="24" fill="rgba(255,255,255,.03)"/>
      <line x1="0" y1="92" x2="640" y2="92" stroke="rgba(255,255,255,.06)" strokeWidth="0.5" strokeDasharray="18 12"/>
      <text x="14" y="77" fontSize="8" fill="rgba(255,255,255,.20)" fontFamily="sans-serif">CHURCH TCE</text>
      <rect x="230" y="64" width="200" height="56" rx="4" fill="rgba(245,158,11,.04)" stroke="rgba(245,158,11,.18)" strokeWidth="0.8" strokeDasharray="4 3"/>
      <text x="330" y="77" textAnchor="middle" fontSize="7.5" fill="rgba(245,158,11,.7)" fontFamily="sans-serif" fontWeight="700">GPS GAP 08:41–08:47</text>
      <text x="330" y="89" textAnchor="middle" fontSize="7" fill="rgba(245,158,11,.5)" fontFamily="sans-serif">6 min · no position data</text>
      <path d="M 0,91 C 50,90 100,90 160,90 S 210,90 230,90" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.5"/>
      <path d="M 430,91 C 460,91 510,92 560,93 S 610,94 640,95" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.5"/>
      {[35,90,148,205].map(x=><circle key={x} cx={x} cy={91} r="3.5" fill="rgba(255,255,255,.28)"/>)}
      {[435,495,555,608].map((x,i)=><circle key={x} cx={x} cy={[91,92,93,95][i]} r="3.5" fill="rgba(255,255,255,.28)"/>)}
      <line x1="310" y1="104" x2="310" y2="148" stroke="rgba(255,255,255,.07)" strokeWidth="1" strokeDasharray="4 4"/>
      <rect x="282" y="148" width="56" height="36" rx="3" fill="rgba(245,158,11,.05)" stroke="rgba(245,158,11,.22)" strokeWidth="1"/>
      <path d="M 285,158 L 310,148 L 335,158" fill="none" stroke="rgba(245,158,11,.35)" strokeWidth="1"/>
      <text x="310" y="176" fontSize="8" textAnchor="middle" fill="rgba(245,158,11,.65)" fontFamily="sans-serif">PROPERTY</text>
      <text x="310" y="122" fontSize="22" textAnchor="middle" fill="rgba(245,158,11,.18)" fontFamily="sans-serif" fontWeight="700">?</text>
      <circle cx="205" cy="90" r="5" fill="#f59e0b" opacity="0.85"/>
      <text x="180" y="77" fontSize="7.5" fill="rgba(245,158,11,.7)" fontFamily="sans-serif">Last GPS 08:41</text>
      <circle cx="435" cy="91" r="5" fill="#f59e0b" opacity="0.85"/>
      <text x="440" y="79" fontSize="7.5" fill="rgba(245,158,11,.7)" fontFamily="sans-serif">GPS resumed 08:47</text>
      <text x="614" y="24" fontSize="8" fill="rgba(255,255,255,.22)" fontFamily="sans-serif" textAnchor="middle">N ↑</text>
    </svg>
  );

  return (
    <svg viewBox="0 0 640 200" width="100%" style={{ display: 'block', borderRadius: '0 0 12px 12px' }}>
      <rect width="640" height="200" fill="#07080B"/>
      <pattern id="g4" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,.03)" strokeWidth="0.5"/></pattern>
      <rect width="640" height="200" fill="url(#g4)"/>
      <rect x="294" y="80" width="52" height="40" rx="3" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.10)" strokeWidth="1"/>
      <path d="M 297,90 L 320,80 L 343,90" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="1"/>
      <text x="320" y="112" fontSize="8" textAnchor="middle" fill="rgba(255,255,255,.30)" fontFamily="sans-serif">PROPERTY</text>
      <rect x="0" y="0" width="640" height="200" fill="rgba(7,8,11,.55)"/>
      <text x="320" y="90" textAnchor="middle" fontSize="12" fill="rgba(255,255,255,.20)" fontFamily="sans-serif" fontWeight="600">No GPS coverage recorded</text>
      <text x="320" y="112" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,.12)" fontFamily="sans-serif">Vehicle location data unavailable for this date</text>
    </svg>
  );
}

// ─── Engine Evidence Panel ────────────────────────────────────────────────────

function EngineResultPanel({ result }: { result: VerificationResult }) {
  const meta = STATUS_META[result.status] ?? FALLBACK_META;
  const conf = result.confidence;
  const confColor = conf >= 75 ? '#4ade80' : conf >= 45 ? '#fbbf24' : '#f87171';
  const confGrad  = conf >= 75 ? 'linear-gradient(90deg,#16a34a,#22c55e)'
    : conf >= 45 ? 'linear-gradient(90deg,#d97706,#f59e0b)'
    : 'linear-gradient(90deg,#dc2626,#ef4444)';

  const checks = [
    { label: 'GPS pass',       on: result.passDetected },
    { label: 'Stop / dwell',   on: result.stopDetected },
    { label: 'Lift / RFID',    on: result.liftDetected },
    { label: 'In window',      on: !!result.inServiceWindow },
    { label: 'GPS gap',        on: result.gpsGapSec !== null, warn: true },
    { label: 'Exception',      on: result.exceptionDetected, warn: true },
  ];

  return (
    <div style={{ background: 'rgba(255,255,255,.02)', border: `1px solid ${meta.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 16px', background: meta.bg, borderBottom: `1px solid ${meta.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: meta.dot, boxShadow: `0 0 6px ${meta.dot}` }}/>
          <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.label}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', marginLeft: 2 }}>— Engine result</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: confColor, background: 'rgba(255,255,255,.05)', padding: '2px 9px', borderRadius: 20 }}>
          {conf}% confidence
        </span>
      </div>
      <div style={{ height: 2, background: 'rgba(255,255,255,.04)' }}>
        <div style={{ height: '100%', width: `${conf}%`, background: confGrad }}/>
      </div>
      <div style={{ padding: '14px 16px' }}>
        {/* Evidence checks */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {checks.map(({ label, on, warn }) => (
            <span key={label} style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
              background: on ? (warn ? 'rgba(251,146,60,.10)' : 'rgba(34,197,94,.10)') : 'rgba(255,255,255,.04)',
              color: on ? (warn ? '#fb923c' : '#4ade80') : 'rgba(255,255,255,.28)',
              border: `1px solid ${on ? (warn ? 'rgba(251,146,60,.25)' : 'rgba(34,197,94,.20)') : 'rgba(255,255,255,.07)'}`,
            }}>
              {on ? (warn ? '⚠ ' : '✓ ') : '— '}{label}
            </span>
          ))}
          {result.nearestGpsM !== null && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', padding: '2px 8px' }}>
              Nearest GPS: {result.nearestGpsM}m
            </span>
          )}
          {result.stopDurationSec !== null && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', padding: '2px 8px' }}>
              Dwell: {result.stopDurationSec}s
            </span>
          )}
        </div>
        {/* Evidence summary */}
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(245,247,250,.60)', lineHeight: 1.6, fontStyle: 'italic' }}>
          {result.evidenceSummary}
        </p>
      </div>
    </div>
  );
}

// ─── Verification Hero ─────────────────────────────────────────────────────────

function VerificationHero({ v }: { v: PropertyData['verification'] }) {
  const meta = STATUS_META[v.status] ?? FALLBACK_META;
  return (
    <div style={{ background: 'rgba(255,255,255,.02)', border: `1px solid ${meta.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', background: meta.bg, borderBottom: `1px solid ${meta.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: meta.dot, boxShadow: `0 0 8px ${meta.dot}` }}/>
          <span style={{ fontSize: 14, fontWeight: 700, color: meta.color }}>{meta.label}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.30)' }}>— Static reference data</span>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: v.confidence >= 75 ? '#4ade80' : v.confidence >= 45 ? '#fbbf24' : '#f87171', background: 'rgba(255,255,255,.06)', padding: '3px 10px', borderRadius: 20 }}>
          {v.confidence}% confidence
        </div>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,.05)' }}>
        <div style={{ height: '100%', width: `${v.confidence}%`, background: v.confidence >= 75 ? 'linear-gradient(90deg,#16a34a,#22c55e)' : v.confidence >= 45 ? 'linear-gradient(90deg,#d97706,#f59e0b)' : 'linear-gradient(90deg,#dc2626,#ef4444)' }}/>
      </div>
      <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px 20px' }}>
        {[
          { label: 'Vehicle',    value: v.vehicle_reg ?? '—' },
          { label: 'Driver',     value: v.driver ?? '—' },
          { label: 'Run',        value: v.run_name ?? '—' },
          { label: 'Pass Time',  value: v.pass_time ?? 'Not recorded',  ok: !!v.pass_time },
          { label: 'Distance',   value: v.distance_m != null ? `${v.distance_m}m` : 'Unknown', ok: v.distance_m != null && v.distance_m < 20 },
          { label: 'Speed',      value: v.speed_kmh != null ? `${v.speed_kmh} km/h` : 'Unknown' },
          { label: 'Exception',  value: v.linked_exception ?? 'None', ok: !v.linked_exception },
          { label: 'GPS Nearby', value: `${v.gps_points_nearby} point${v.gps_points_nearby !== 1 ? 's' : ''}` },
        ].map(({ label, value, ok }) => (
          <div key={label}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: ok ? '#4ade80' : '#F5F7FA' }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Intelligence Summary ─────────────────────────────────────────────────────

function IntelligenceSummary({ summary, action, level }: { summary: string; action: string | null; level: PropertyData['intelligence_level'] }) {
  const map = {
    good:    { bg: 'rgba(34,197,94,.07)',  border: 'rgba(34,197,94,.22)',  accent: '#4ade80',  icon: '✓', title: 'Service Confirmed' },
    warning: { bg: 'rgba(245,158,11,.07)', border: 'rgba(245,158,11,.22)', accent: '#fbbf24', icon: '⚠', title: 'Verification Inconclusive' },
    alert:   { bg: 'rgba(239,68,68,.07)',  border: 'rgba(239,68,68,.22)',  accent: '#f87171', icon: '!', title: 'Service Issue Identified' },
  };
  const s = map[level];
  return (
    <div style={{ marginBottom: 24, padding: '18px 20px', background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: `${s.accent}22`, border: `1px solid ${s.accent}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: s.accent }}>
          {s.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: s.accent, textTransform: 'uppercase', marginBottom: 5 }}>
            Intelligence Summary · {s.title}
          </div>
          <p style={{ fontSize: 13, color: 'rgba(245,247,250,.80)', lineHeight: 1.65, margin: '0 0 6px' }}>{summary}</p>
          {action && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.accent, paddingTop: 1 }}>→</span>
              <span style={{ fontSize: 12, color: s.accent, fontWeight: 500, fontStyle: 'italic' }}>{action}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Assets Panel ─────────────────────────────────────────────────────────────

function AssetsPanel({ assets, planned }: { assets: PropertyData['assets']; planned: PropertyData['planned_services'] }) {
  const binColour = (c: string) => c.includes('Red') ? '#dc2626' : c.includes('Yellow') ? '#ca8a04' : c.includes('Green') ? '#16a34a' : '#6366f1';
  return (
    <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', marginBottom: 14 }}>Bin Assets</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {assets.map(a => (
          <div key={a.rfid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: binColour(a.colour) }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(245,247,250,.80)' }}>{a.type}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.32)' }}>{a.volume} · {a.colour}</div>
            </div>
            {a.rfid && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#60a5fa', background: 'rgba(96,165,250,.10)', border: '1px solid rgba(96,165,250,.20)', padding: '1px 6px', borderRadius: 10 }}>
                {a.rfid}
              </span>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, color: '#4ade80', background: 'rgba(34,197,94,.10)', padding: '1px 6px', borderRadius: 10 }}>
              {a.status}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', marginBottom: 10 }}>Scheduled Services</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {planned.map(p => (
            <div key={p.service_type} style={{ padding: '8px 10px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 7 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(245,247,250,.75)', marginBottom: 2 }}>{p.service_type}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,.32)' }}>{p.schedule} · {p.window}</div>
              <div style={{ fontSize: 10, color: TEAL, marginTop: 2 }}>Next: {p.next_date}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PropertyClient({ data, engineResult }: { data: PropertyData; propertyId: string; engineResult?: VerificationResult | null }) {
  // Use engine result for the status badge if available
  const displayStatus = engineResult?.status ?? data.verification.status;
  const displayConfidence = engineResult?.confidence ?? data.verification.confidence;
  const statusMeta = STATUS_META[displayStatus] ?? FALLBACK_META;

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{`@keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.15)}}.prop-two-col{grid-template-columns:1fr 360px;}@media(max-width:900px){.prop-two-col{grid-template-columns:1fr;}}`}</style>
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: `radial-gradient(ellipse 45% 30% at 50% 0%, ${displayStatus === 'verified' ? 'rgba(34,197,94,.05)' : displayStatus === 'likely_missed' || displayStatus === 'exception_recorded' ? 'rgba(239,68,68,.05)' : displayStatus === 'likely_completed' ? 'rgba(45,212,191,.05)' : 'rgba(245,158,11,.05)'} 0%, transparent 60%)` }}/>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 32px 80px', position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Link href="/dashboard/wste" style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = TEAL)}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.35)')}>
                ← WSTe
              </Link>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.18)' }}>/</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.38)' }}>Property Intelligence</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: '#F5F7FA', margin: '0 0 3px' }}>{data.address}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.40)' }}>{data.suburb} · {data.zone}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,.18)' }}>·</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', fontFamily: 'monospace' }}>{data.account_ref}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: statusMeta.bg, border: `1px solid ${statusMeta.border}`, borderRadius: 24, flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusMeta.dot, animation: 'pulse-dot 2s infinite' }}/>
            <span style={{ fontSize: 14, fontWeight: 700, color: statusMeta.color }}>{statusMeta.label}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginLeft: 2 }}>{displayConfidence}% confidence</span>
            {engineResult && <span style={{ fontSize: 9, fontWeight: 700, color: TEAL, background: 'rgba(45,212,191,.10)', border: '1px solid rgba(45,212,191,.25)', padding: '1px 6px', borderRadius: 8, letterSpacing: '.04em' }}>ENGINE</span>}
          </div>
        </div>

        {/* Key question */}
        <div style={{ marginBottom: 20, padding: '12px 20px', background: 'rgba(45,212,191,.04)', border: '1px solid rgba(45,212,191,.12)', borderRadius: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(245,247,250,.55)', fontStyle: 'italic', lineHeight: 1.5 }}>
            What happened here, when did it happen, and what evidence proves it?
          </p>
        </div>

        {/* Demo disclaimer */}
        <div style={{ marginBottom: 20, padding: '9px 16px', background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.18)', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style={{ fontSize: 11, color: 'rgba(251,191,36,.75)', fontWeight: 500 }}>Demo data only — not live GPS evidence</span>
        </div>

        {/* Intelligence Summary */}
        <IntelligenceSummary summary={data.intelligence_summary} action={data.intelligence_action} level={data.intelligence_level} />

        {/* Two-column: verification + assets */}
        <div className="prop-two-col" style={{ display: 'grid', gap: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {engineResult && <EngineResultPanel result={engineResult} />}
            <VerificationHero v={data.verification} />
            <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,.50)', textTransform: 'uppercase' }}>GPS Evidence — Latest Run</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(251,191,36,.60)', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.18)', padding: '1px 6px', borderRadius: 8, letterSpacing: '.04em' }}>DEMO</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: statusMeta.color, background: statusMeta.bg, border: `1px solid ${statusMeta.border}`, padding: '2px 8px', borderRadius: 20 }}>
                  {engineResult
                    ? (engineResult.status === 'verified' ? 'Pass confirmed'
                      : engineResult.status === 'exception_recorded' ? 'Exception recorded'
                      : engineResult.status === 'likely_completed' ? 'Pass likely'
                      : engineResult.status === 'likely_missed' ? 'Route bypassed'
                      : engineResult.status === 'no_coverage' ? 'No coverage'
                      : 'Inconclusive')
                    : (data.verification.scenario === 'route_pass' ? 'Pass confirmed'
                      : data.verification.scenario === 'route_bypass' ? 'Route bypassed'
                      : data.verification.scenario === 'gps_gap' ? 'Data gap'
                      : 'No coverage')}
                </span>
              </div>
              <GPSMap scenario={data.verification.scenario} status={data.verification.status} />
            </div>
          </div>
          <AssetsPanel assets={data.assets} planned={data.planned_services} />
        </div>

        {/* Service Timeline — full width */}
        <ServiceTimeline events={data.service_events} title="Service & Evidence Timeline" />
      </div>
    </main>
  );
}
