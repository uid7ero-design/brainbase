'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { WSTEKpis, WSTERun, WSTEException, WSTEVehicle } from './page';

function propertyHref(address: string) {
  return `/dashboard/wste/property/${encodeURIComponent(address.toLowerCase().replace(/\s+/g, '-'))}`;
}

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG   = '#07080B';
const TEAL = '#2DD4BF';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  } catch { return s; }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, icon, accent = TEAL }: {
  label: string; value: string | number; unit?: string; icon: React.ReactNode; accent?: string;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase' }}>
          {label}
        </span>
        <div style={{ color: accent, opacity: 0.75 }}>{icon}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: '#F5F7FA' }}>
          {typeof value === 'number' ? fmt(value) : value}
        </span>
        {unit && <span style={{ fontSize: 12, color: 'rgba(255,255,255,.38)' }}>{unit}</span>}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const map = {
    high:   { bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.25)',  color: '#f87171', label: 'High'   },
    medium: { bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.25)', color: '#fbbf24', label: 'Medium' },
    low:    { bg: 'rgba(34,197,94,.10)',  border: 'rgba(34,197,94,.20)',  color: '#4ade80', label: 'Low'    },
  };
  const s = map[severity];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
      padding: '2px 7px', borderRadius: 20, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
      {s.label}
    </span>
  );
}

function AddressLookup() {
  const [address, setAddress] = useState('');
  const [result, setResult]   = useState<null | { found: boolean; passes: number; lastDate: string; driver: string; vehicle: string }>(null);
  const [loading, setLoading] = useState(false);

  function lookup() {
    if (!address.trim()) return;
    setLoading(true);
    setTimeout(() => {
      const found = Math.random() > 0.25;
      setResult(found ? {
        found:    true,
        passes:   Math.floor(Math.random() * 6) + 1,
        lastDate: '28 Apr 2025',
        driver:   ['J. Thompson', 'M. Evans', 'R. Carter', 'T. Walsh'][Math.floor(Math.random() * 4)],
        vehicle:  ['S123ABC', 'S456DEF', 'S789GHI', 'S321JKL'][Math.floor(Math.random() * 4)],
      } : { found: false, passes: 0, lastDate: '', driver: '', vehicle: '' });
      setLoading(false);
    }, 800);
  }

  return (
    <div style={{ background: 'rgba(45,212,191,.04)', border: '1px solid rgba(45,212,191,.14)', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.8">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        <span style={{ fontSize: 12, fontWeight: 700, color: TEAL, letterSpacing: '.06em' }}>ADDRESS SERVICE VERIFICATION</span>
      </div>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,.40)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Enter a property address to verify if a waste truck passed and completed service.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={address}
          onChange={e => { setAddress(e.target.value); setResult(null); }}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="e.g. 14 Edmund Ave, Trinity Gardens"
          style={{
            flex: 1, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)',
            borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#F5F7FA',
            fontFamily: FONT, outline: 'none',
          }}
        />
        <button
          onClick={lookup}
          disabled={loading || !address.trim()}
          style={{
            padding: '9px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: loading ? 'rgba(45,212,191,.10)' : 'rgba(45,212,191,.18)',
            border: '1px solid rgba(45,212,191,.30)', color: TEAL,
            cursor: loading ? 'default' : 'pointer', fontFamily: FONT, letterSpacing: '.02em',
            transition: 'background .15s',
          }}>
          {loading ? '...' : 'Verify'}
        </button>
      </div>

      {result && (
        <div style={{
          marginTop: 14, padding: 14, borderRadius: 8,
          background: result.found ? 'rgba(34,197,94,.06)' : 'rgba(239,68,68,.06)',
          border: `1px solid ${result.found ? 'rgba(34,197,94,.18)' : 'rgba(239,68,68,.18)'}`,
        }}>
          {result.found ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#4ade80' }}>Service Verified</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 12 }}>
                {[
                  ['GPS Passes', String(result.passes)],
                  ['Last Service', result.lastDate],
                  ['Vehicle', result.vehicle],
                  ['Driver', result.driver],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', fontWeight: 600, letterSpacing: '.06em', marginBottom: 2 }}>{k}</div>
                    <div style={{ fontSize: 12, color: '#F5F7FA', fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>
              <Link href={propertyHref(address)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontWeight: 600, color: TEAL, textDecoration: 'none',
                background: 'rgba(45,212,191,.10)', border: '1px solid rgba(45,212,191,.22)',
                padding: '5px 12px', borderRadius: 20, letterSpacing: '.02em',
              }}>
                View Property Intelligence →
              </Link>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#f87171' }}>No GPS record found for this address</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MapPlaceholder() {
  return (
    <div style={{
      background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 12, height: 280, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, position: 'relative', overflow: 'hidden',
    }}>
      {/* Grid lines */}
      <svg style={{ position: 'absolute', inset: 0, opacity: 0.06 }} width="100%" height="100%">
        <defs>
          <pattern id="wste-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#2DD4BF" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wste-grid)"/>
      </svg>
      {/* Dot markers */}
      {[
        [28, 40], [55, 65], [72, 30], [40, 75], [85, 55], [18, 80], [62, 48],
      ].map(([x, y], i) => (
        <div key={i} style={{
          position: 'absolute', left: `${x}%`, top: `${y}%`,
          width: 8, height: 8, borderRadius: '50%', transform: 'translate(-50%, -50%)',
          background: i % 3 === 0 ? '#f87171' : TEAL,
          boxShadow: `0 0 6px ${i % 3 === 0 ? '#f87171' : TEAL}`,
          opacity: 0.7,
        }} />
      ))}
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.2" style={{ opacity: 0.5, marginBottom: 6 }}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', fontWeight: 500 }}>GPS route map</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.18)' }}>Live service route data will appear here when connected</div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WSTEClient({
  isDemo, kpis, runs, exceptions, vehicles,
}: {
  isDemo: boolean;
  kpis: WSTEKpis;
  runs: WSTERun[];
  exceptions: WSTEException[];
  vehicles: WSTEVehicle[];
}) {
  const [tab, setTab] = useState<'runs' | 'exceptions'>('runs');
  const [showResolved, setShowResolved] = useState(false);

  const visibleExceptions = showResolved
    ? exceptions
    : exceptions.filter(e => !e.resolved);

  const openExceptions    = exceptions.filter(e => !e.resolved).length;
  const highSeverity      = exceptions.filter(e => !e.resolved && e.severity === 'high').length;

  return (
    <main style={{ minHeight: '100vh', background: BG, color: '#F5F7FA', fontFamily: FONT }}>
      <style>{`.wste-main-grid{grid-template-columns:1fr 380px;}@media(max-width:900px){.wste-main-grid{grid-template-columns:1fr;}}`}</style>
      {/* Ambient */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 50% 35% at 50% 0%, rgba(45,212,191,.07) 0%, transparent 55%)',
      }} />

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '36px 32px 80px', position: 'relative', zIndex: 1 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9,
                background: 'rgba(45,212,191,.10)', border: '1px solid rgba(45,212,191,.20)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEAL,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', color: 'rgba(45,212,191,.65)', textTransform: 'uppercase', marginBottom: 2 }}>
                  Waste Service Tracking Engine
                </div>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.03em', color: '#F5F7FA', margin: 0 }}>
                  WSTe — Waste Service Tracking & Exceptions
                </h1>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.38)', margin: 0 }}>
              Multi-stream service verification · GPS evidence · bin lifts · route analysis · exception management
            </p>
          </div>
          {isDemo && (
            <span style={{
              padding: '4px 12px', borderRadius: 20,
              background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.22)',
              fontSize: 10, fontWeight: 700, color: '#fbbf24', letterSpacing: '.06em',
            }}>
              DEMO
            </span>
          )}
        </div>

        {/* Demo disclaimer */}
        {isDemo && (
          <div style={{
            marginBottom: 24, padding: '10px 16px',
            background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.20)',
            borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style={{ fontSize: 11, color: 'rgba(251,191,36,.80)', fontWeight: 500 }}>
              Demo data only — not live GPS evidence. Connect a GPS or service management provider to ingest real data.
            </span>
          </div>
        )}

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 28 }}>
          <KpiCard label="GPS Points" value={kpis.total_gps_points} icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          } />
          <KpiCard label="Vehicles Tracked" value={kpis.vehicles_tracked} icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
          } />
          <KpiCard label="Runs Analysed" value={kpis.runs_analysed} icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          } />
          <KpiCard label="Tickets Matched" value={kpis.tickets_matched} icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          } />
          <KpiCard label="Exceptions" value={kpis.exceptions_identified}
            accent={openExceptions > 0 ? '#f87171' : TEAL}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            }
          />
          <KpiCard label="Verification Rate" value={kpis.verification_rate} unit="%" icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          } />
        </div>

        {/* Exception alert banner */}
        {openExceptions > 0 && (
          <div style={{
            marginBottom: 24, padding: '12px 16px',
            background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)',
            borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span style={{ fontSize: 12, color: '#f87171', fontWeight: 600 }}>
              {openExceptions} open exception{openExceptions !== 1 ? 's' : ''}
              {highSeverity > 0 && ` — ${highSeverity} high severity`} requiring review
            </span>
          </div>
        )}

        {/* Main grid */}
        <div className="wste-main-grid" style={{ display: 'grid', gap: 20, marginBottom: 20 }}>
          {/* Map */}
          <MapPlaceholder />
          {/* Address lookup */}
          <AddressLookup />
        </div>

        {/* Vehicles strip */}
        <div style={{ marginBottom: 24, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 12 }}>
            Active Fleet — {vehicles.length} vehicles
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {vehicles.map(v => (
              <div key={v.id} style={{
                padding: '7px 12px', borderRadius: 8,
                background: 'rgba(45,212,191,.06)', border: '1px solid rgba(45,212,191,.14)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: TEAL, marginBottom: 2 }}>{v.registration}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.40)' }}>{v.make} {v.model} · {v.vehicle_type}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.25)', marginTop: 1 }}>{v.depot}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs: Recent Runs / Exceptions */}
        <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,.07)', padding: '0 20px' }}>
            {(['runs', 'exceptions'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '12px 0', marginRight: 24, background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: FONT,
                  color: tab === t ? TEAL : 'rgba(255,255,255,.38)',
                  borderBottom: tab === t ? `2px solid ${TEAL}` : '2px solid transparent',
                  transition: 'color .15s', letterSpacing: '.02em',
                }}>
                {t === 'runs' ? `Recent Runs (${runs.length})` : `Exceptions (${visibleExceptions.length})`}
              </button>
            ))}
            {tab === 'exceptions' && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,.38)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <input
                    type="checkbox"
                    checked={showResolved}
                    onChange={e => setShowResolved(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  Show resolved
                </label>
              </div>
            )}
          </div>

          {tab === 'runs' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                    {['Date', 'Vehicle', 'Driver', 'Route / Suburb', 'GPS Pts', 'Tickets', 'Exceptions', 'Complete', 'Status'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                        letterSpacing: '.08em', color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={r.id} style={{
                      borderBottom: i < runs.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                      background: i % 2 === 1 ? 'rgba(255,255,255,.01)' : 'transparent',
                    }}>
                      <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.55)' }}>{fmtDate(r.run_date)}</td>
                      <td style={{ padding: '10px 16px', fontWeight: 600, color: TEAL }}>{r.vehicle_registration}</td>
                      <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.65)' }}>{r.driver}</td>
                      <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.65)' }}>
                        <div style={{ fontSize: 11 }}>{r.route_name}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>{r.suburb}</div>
                      </td>
                      <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.65)' }}>{fmt(r.gps_points)}</td>
                      <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.65)' }}>{r.tickets_matched}</td>
                      <td style={{ padding: '10px 16px' }}>
                        {r.exceptions_count > 0 ? (
                          <span style={{ color: r.exceptions_count >= 5 ? '#f87171' : '#fbbf24', fontWeight: 600 }}>
                            {r.exceptions_count}
                          </span>
                        ) : (
                          <span style={{ color: '#4ade80' }}>0</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', minWidth: 48 }}>
                            <div style={{
                              height: '100%', borderRadius: 2,
                              width: `${r.completion_pct}%`,
                              background: r.completion_pct >= 98 ? '#4ade80' : r.completion_pct >= 90 ? '#fbbf24' : '#f87171',
                            }} />
                          </div>
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', minWidth: 30 }}>{r.completion_pct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        {r.verified ? (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', background: 'rgba(34,197,94,.10)', border: '1px solid rgba(34,197,94,.20)', padding: '2px 7px', borderRadius: 20 }}>
                            Verified
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.22)', padding: '2px 7px', borderRadius: 20 }}>
                            Review
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'exceptions' && (
            <div style={{ overflowX: 'auto' }}>
              {visibleExceptions.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,.28)', fontSize: 13 }}>
                  No open exceptions — all clear.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                      {['Date', 'Vehicle', 'Address', 'Suburb', 'Exception Type', 'Severity', 'Status'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                          letterSpacing: '.08em', color: 'rgba(255,255,255,.28)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleExceptions.map((e, i) => (
                      <tr key={e.id} style={{
                        borderBottom: i < visibleExceptions.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                        background: e.resolved ? 'rgba(255,255,255,.005)' : i % 2 === 1 ? 'rgba(255,255,255,.01)' : 'transparent',
                        opacity: e.resolved ? 0.55 : 1,
                      }}>
                        <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.55)' }}>{fmtDate(e.run_date)}</td>
                        <td style={{ padding: '10px 16px', fontWeight: 600, color: TEAL }}>{e.vehicle_registration}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <Link href={propertyHref(e.address)} style={{
                            color: TEAL, textDecoration: 'none', fontSize: 12,
                            borderBottom: '1px solid rgba(45,212,191,.25)',
                          }}
                            onMouseEnter={ev => (ev.currentTarget.style.borderBottomColor = TEAL)}
                            onMouseLeave={ev => (ev.currentTarget.style.borderBottomColor = 'rgba(45,212,191,.25)')}>
                            {e.address}
                          </Link>
                        </td>
                        <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.45)' }}>{e.suburb}</td>
                        <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,.65)' }}>{e.exception_type}</td>
                        <td style={{ padding: '10px 16px' }}><SeverityBadge severity={e.severity} /></td>
                        <td style={{ padding: '10px 16px' }}>
                          {e.resolved ? (
                            <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)' }}>Resolved</span>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.20)', padding: '2px 7px', borderRadius: 20 }}>
                              Open
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
