'use client';
import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { WSTEKpis, WSTERun, WSTEException, WSTEVehicle } from './page';
import {
  PageHeader, Panel, MetricStrip, Metric, Button, buttonProps, Badge, Banner,
  TableContainer, tableStyles, fieldControlClassName, StateMessage,
} from '@/components/ui/app';
import s from './Wste.module.css';

function propertyHref(address: string) {
  return `/dashboard/wste/property/${encodeURIComponent(address.toLowerCase().replace(/\s+/g, '-'))}`;
}

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

const SEVERITY_BADGE = {
  high:   { state: 'error',   label: 'High'   },
  medium: { state: 'warning', label: 'Medium' },
  low:    { state: 'success', label: 'Low'    },
} as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  const b = SEVERITY_BADGE[severity];
  return <Badge state={b.state}>{b.label}</Badge>;
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
    <Panel title="Address Service Verification">
      <p className={s.lookupIntro}>
        Enter a property address to verify if a waste truck passed and completed service.
      </p>
      <div className={s.lookupRow}>
        <input
          value={address}
          onChange={e => { setAddress(e.target.value); setResult(null); }}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          placeholder="e.g. 14 Edmund Ave, Trinity Gardens"
          aria-label="Property address"
          className={fieldControlClassName}
        />
        <Button
          variant="primary"
          onClick={lookup}
          disabled={loading || !address.trim()}>
          {loading ? '...' : 'Verify'}
        </Button>
      </div>

      <div aria-live="polite">
        {result && (
          <div className={s.lookupResult} data-tone={result.found ? undefined : 'danger'}>
            {result.found ? (
              <>
                <p className={s.resultHead}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Service Verified
                </p>
                <dl className={s.factGrid}>
                  {[
                    ['GPS Passes', String(result.passes)],
                    ['Last Service', result.lastDate],
                    ['Vehicle', result.vehicle],
                    ['Driver', result.driver],
                  ].map(([k, v]) => (
                    <div key={k} className={s.fact}>
                      <dt className={s.factLabel}>{k}</dt>
                      <dd className={s.factValue}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <Link href={propertyHref(address)} {...buttonProps('secondary', 'sm')}>
                  View Property Intelligence →
                </Link>
              </>
            ) : (
              <p className={s.resultHead} data-tone="danger">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                No GPS record found for this address
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function MapPlaceholder() {
  return (
    <div className={s.mapPlaceholder}>
      {/* Grid lines */}
      <svg className={s.mapGridSvg} width="100%" height="100%" aria-hidden="true">
        <defs>
          <pattern id="wste-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" className={s.mapGridLine}/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wste-grid)"/>
      </svg>
      {/* Dot markers (decorative) */}
      {[
        [28, 40], [55, 65], [72, 30], [40, 75], [85, 55], [18, 80], [62, 48],
      ].map(([x, y], i) => (
        <span key={i} aria-hidden="true" className={s.mapMarker} data-tone={i % 3 === 0 ? 'danger' : undefined}
          style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className={s.icon} style={{ position: 'relative' }} aria-hidden="true">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
      </svg>
      <p className={s.mapCaption}>GPS route map</p>
      <p className={s.mapCaptionSub}>Live service route data will appear here when connected</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const TABS = ['runs', 'exceptions'] as const;

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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  const visibleExceptions = showResolved
    ? exceptions
    : exceptions.filter(e => !e.resolved);

  const openExceptions    = exceptions.filter(e => !e.resolved).length;
  const highSeverity      = exceptions.filter(e => !e.resolved && e.severity === 'high').length;

  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]);
    tabRefs.current[next]?.focus();
  }

  return (
    <main className={s.page}>
      <div className={s.inner}>

        {/* Header */}
        <PageHeader
          eyebrow="Waste Service Tracking Engine"
          title="WSTe — Waste Service Tracking & Exceptions"
          meta={isDemo ? <Badge state="warning">DEMO</Badge> : undefined}
          description="Multi-stream service verification · GPS evidence · bin lifts · route analysis · exception management"
        />

        {/* Demo disclaimer */}
        {isDemo && (
          <Banner state="warning" title="Demo data only — not live GPS evidence.">
            Connect a GPS or service management provider to ingest real data.
          </Banner>
        )}

        {/* KPI strip */}
        <MetricStrip>
          <Metric label="GPS Points" value={fmt(kpis.total_gps_points)} />
          <Metric label="Vehicles Tracked" value={fmt(kpis.vehicles_tracked)} />
          <Metric label="Runs Analysed" value={fmt(kpis.runs_analysed)} />
          <Metric label="Tickets Matched" value={fmt(kpis.tickets_matched)} />
          <Metric label="Exceptions" value={fmt(kpis.exceptions_identified)} tone={openExceptions > 0 ? 'danger' : undefined} />
          <Metric label="Verification Rate" value={<>{fmt(kpis.verification_rate)}<span className={s.unit}>%</span></>} />
        </MetricStrip>

        {/* Exception alert banner */}
        {openExceptions > 0 && (
          <Banner
            state="error"
            title={`${openExceptions} open exception${openExceptions !== 1 ? 's' : ''}${highSeverity > 0 ? ` — ${highSeverity} high severity` : ''} requiring review`}
          />
        )}

        {/* Main grid */}
        <div className={s.mainGrid}>
          {/* Map */}
          <MapPlaceholder />
          {/* Address lookup */}
          <AddressLookup />
        </div>

        {/* Vehicles strip */}
        <Panel title={`Active Fleet — ${vehicles.length} vehicles`}>
          <ul className={s.vehicleList}>
            {vehicles.map(v => (
              <li key={v.id} className={s.vehicle}>
                <p className={s.vehicleReg}>{v.registration}</p>
                <p className={s.vehicleMeta}>{v.make} {v.model} · {v.vehicle_type}</p>
                <p className={s.vehicleDepot}>{v.depot}</p>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Tabs: Recent Runs / Exceptions */}
        <section className={s.card} aria-label="Runs and exceptions">
          {/* Tab bar */}
          <div className={s.tabBar}>
            <div role="tablist" aria-label="WSTe views" className={s.tabList} onKeyDown={onTabKeyDown}>
              {TABS.map((t, i) => (
                <button
                  key={t}
                  ref={el => { tabRefs.current[i] = el; }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={tab === t ? `${baseId}-panel-${t}` : undefined}
                  tabIndex={tab === t ? 0 : -1}
                  onClick={() => setTab(t)}
                  className={s.tab}>
                  {t === 'runs' ? `Recent Runs (${runs.length})` : `Exceptions (${visibleExceptions.length})`}
                </button>
              ))}
            </div>
            {tab === 'exceptions' && (
              <label className={s.checkLabel}>
                <input
                  type="checkbox"
                  checked={showResolved}
                  onChange={e => setShowResolved(e.target.checked)}
                />
                Show resolved
              </label>
            )}
          </div>

          {tab === 'runs' && (
            <div role="tabpanel" id={`${baseId}-panel-runs`} aria-labelledby={`${baseId}-tab-runs`} className={s.tabPanel}>
              <TableContainer label="Recent runs" minWidth={880} className={s.flushTable}>
                <table className={tableStyles.table}>
                  <thead>
                    <tr>
                      {['Date', 'Vehicle', 'Driver', 'Route / Suburb', 'GPS Pts', 'Tickets', 'Exceptions', 'Complete', 'Status'].map(h => (
                        <th key={h} scope="col" className={h === 'GPS Pts' || h === 'Tickets' || h === 'Exceptions' ? tableStyles.num : undefined}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(r => (
                      <tr key={r.id}>
                        <td>{fmtDate(r.run_date)}</td>
                        <td className={`${tableStyles.primary} ${s.mono}`}>{r.vehicle_registration}</td>
                        <td>{r.driver}</td>
                        <td>
                          <span>{r.route_name}</span>
                          <span className={s.cellSub}>{r.suburb}</span>
                        </td>
                        <td className={tableStyles.num}>{fmt(r.gps_points)}</td>
                        <td className={tableStyles.num}>{r.tickets_matched}</td>
                        <td className={tableStyles.num}>
                          <span className={s.count} data-tone={r.exceptions_count >= 5 ? 'danger' : r.exceptions_count > 0 ? 'warning' : undefined}>
                            {r.exceptions_count > 0 ? r.exceptions_count : 0}
                          </span>
                        </td>
                        <td>
                          <div className={s.meter}>
                            <div className={s.meterTrack} aria-hidden="true">
                              <div
                                className={s.meterFill}
                                data-tone={r.completion_pct >= 98 ? undefined : r.completion_pct >= 90 ? 'warning' : 'danger'}
                                style={{ width: `${r.completion_pct}%` }}
                              />
                            </div>
                            <span className={s.meterValue}>{r.completion_pct}%</span>
                          </div>
                        </td>
                        <td>
                          {r.verified
                            ? <Badge state="success">Verified</Badge>
                            : <Badge state="warning">Review</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            </div>
          )}

          {tab === 'exceptions' && (
            <div role="tabpanel" id={`${baseId}-panel-exceptions`} aria-labelledby={`${baseId}-tab-exceptions`} className={s.tabPanel}>
              {visibleExceptions.length === 0 ? (
                <div className={s.emptyCell}>
                  <StateMessage kind="empty" title="No open exceptions — all clear." />
                </div>
              ) : (
                <TableContainer label="Exceptions" minWidth={760} className={s.flushTable}>
                  <table className={tableStyles.table}>
                    <thead>
                      <tr>
                        {['Date', 'Vehicle', 'Address', 'Suburb', 'Exception Type', 'Severity', 'Status'].map(h => (
                          <th key={h} scope="col">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleExceptions.map(e => (
                        <tr key={e.id} className={e.resolved ? s.resolvedRow : undefined}>
                          <td>{fmtDate(e.run_date)}</td>
                          <td className={`${tableStyles.primary} ${s.mono}`}>{e.vehicle_registration}</td>
                          <td>
                            <Link href={propertyHref(e.address)} className={tableStyles.link}>
                              {e.address}
                            </Link>
                          </td>
                          <td>{e.suburb}</td>
                          <td>{e.exception_type}</td>
                          <td><SeverityBadge severity={e.severity} /></td>
                          <td>
                            {e.resolved
                              ? <Badge state="inactive">Resolved</Badge>
                              : <Badge state="error">Open</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
