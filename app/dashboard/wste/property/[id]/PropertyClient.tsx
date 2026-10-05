'use client';
import Link from 'next/link';
import ServiceTimeline from '../../components/ServiceTimeline';
import type { PropertyData, VerificationScenario } from './page';
import type { VerificationResult } from '@/lib/wste/types';
import { PageHeader, Panel, Banner, Badge, type SemanticState } from '@/components/ui/app';
import s from '../../Wste.module.css';

// Verification outcome → semantic state; the label is always written out.
const STATUS_META: Record<string, { label: string; state: SemanticState }> = {
  verified:           { label: 'Verified',           state: 'success'  },
  likely_completed:   { label: 'Likely Completed',   state: 'info'     },
  likely_missed:      { label: 'Likely Missed',      state: 'error'    },
  no_evidence:        { label: 'No Evidence',        state: 'warning'  },
  exception_recorded: { label: 'Exception Recorded', state: 'warning'  },
  no_coverage:        { label: 'No Coverage',        state: 'inactive' },
  not_applicable:     { label: 'N/A',                state: 'inactive' },
};

const FALLBACK_META = STATUS_META['no_evidence'];

function confTone(conf: number): 'warning' | 'danger' | undefined {
  return conf >= 75 ? undefined : conf >= 45 ? 'warning' : 'danger';
}

// ─── GPS Evidence Map ─────────────────────────────────────────────────────────
// Illustrative evidence diagram. Every colour comes from a CSS class
// (Wste.module.css .g*) so it follows the theme; the status accent is the
// svg's data-state → --map-accent.

function GPSMap({ scenario, status }: { scenario: VerificationScenario; status: string }) {
  const accent = status === 'verified' ? 'success'
    : status === 'likely_missed' ? 'error'
    : status === 'exception_recorded' ? 'orange'
    : status === 'likely_completed' ? 'info'
    : 'warning';

  if (scenario === 'route_pass') return (
    <svg viewBox="0 0 640 200" width="100%" className={s.gpsMap} data-state={accent}>
      <rect width="640" height="200" className={s.gBg}/>
      <pattern id="g1" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" className={s.gGrid}/></pattern>
      <rect width="640" height="200" fill="url(#g1)"/>
      <rect x="40" y="20" width="60" height="44" rx="2" className={s.gBlock}/>
      <rect x="130" y="28" width="80" height="36" rx="2" className={s.gBlock}/>
      <rect x="250" y="18" width="55" height="50" rx="2" className={s.gBlock}/>
      <rect x="360" y="24" width="70" height="40" rx="2" className={s.gBlock}/>
      <rect x="490" y="20" width="55" height="46" rx="2" className={s.gBlock}/>
      <rect x="0" y="80" width="640" height="24" className={s.gRoad}/>
      <line x1="0" y1="92" x2="640" y2="92" className={s.gRoadLine} strokeDasharray="18 12"/>
      <text x="14" y="77" className={s.gLabel} letterSpacing="0.05em">AYERS AVE</text>
      <line x1="290" y1="104" x2="290" y2="150" className={s.gConnector} strokeDasharray="4 4"/>
      <rect x="264" y="150" width="52" height="38" rx="3" className={s.gInfoZone}/>
      <path d="M 267,162 L 290,150 L 313,162" className={s.gInfoStroke}/>
      <text x="290" y="178" textAnchor="middle" className={s.gInfoText}>PROPERTY</text>
      <circle cx="290" cy="88" r="22" className={s.gOkZone} strokeDasharray="3 2"/>
      <path d="M 0,90 C 80,88 160,87 240,87 S 340,88 420,89 S 520,91 640,93" className={s.gTrack}/>
      {[40,110,180,240,290,350,420,500,580].map((x, i) => {
        const y=[90,89,88,88,87,88,89,90,92][i]; const near=i===4;
        return <g key={x}><circle cx={x} cy={y} r={near?6:3.5} className={near ? s.gAccent : s.gPoint}/>{near&&<circle cx={x} cy={y} r={14} className={s.gAccentStroke} strokeWidth="1" opacity="0.35"/>}</g>;
      })}
      <line x1="290" y1="87" x2="290" y2="150" className={s.gAccentStroke} strokeWidth="1" strokeDasharray="3 3" opacity="0.7"/>
      <rect x="295" y="106" width="28" height="14" rx="3" className={s.gCallout}/>
      <text x="309" y="117" textAnchor="middle" className={s.gAccentText}>7m</text>
      <rect x="260" y="68" width="60" height="14" rx="3" className={s.gOkZone}/>
      <text x="290" y="79" textAnchor="middle" className={s.gOkText}>09:12:44 ✓</text>
      <text x="614" y="24" className={s.gLabel} textAnchor="middle">N ↑</text>
      <line x1="14" y1="188" x2="64" y2="188" className={s.gConnector}/>
      <text x="39" y="197" textAnchor="middle" className={s.gLabelSmall}>50m</text>
    </svg>
  );

  if (scenario === 'route_bypass') return (
    <svg viewBox="0 0 640 200" width="100%" className={s.gpsMap} data-state={accent}>
      <rect width="640" height="200" className={s.gBg}/>
      <pattern id="g2" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" className={s.gGrid}/></pattern>
      <rect width="640" height="200" fill="url(#g2)"/>
      <rect x="0" y="38" width="640" height="20" className={s.gRoad}/>
      <line x1="0" y1="48" x2="640" y2="48" className={s.gRoadLine} strokeDasharray="18 12"/>
      <text x="14" y="34" className={s.gLabel}>PORTRUSH RD</text>
      <rect x="0" y="118" width="640" height="20" className={s.gRoad}/>
      <text x="14" y="115" className={s.gLabel}>EDMUND AVE / VICTORIA RD</text>
      <rect x="300" y="56" width="18" height="64" className={s.gRoad}/>
      <rect x="160" y="144" width="52" height="36" rx="3" className={s.gDangerZone}/>
      <path d="M 163,154 L 186,144 L 209,154" className={s.gDangerStroke}/>
      <text x="186" y="172" textAnchor="middle" className={s.gDangerText}>PROPERTY</text>
      <path d="M 0,47 C 80,46 160,46 230,46 S 310,47 400,48 S 520,49 640,50" className={s.gTrack}/>
      {[40,110,185,255,330,410,490,570].map((x,i)=><circle key={x} cx={x} cy={[48,47,47,47,47,48,49,50][i]} r="3.5" className={s.gPoint}/>)}
      <circle cx="310" cy="48" r="5.5" className={s.gAccent} opacity="0.8"/>
      <circle cx="310" cy="48" r="12" className={s.gAccentStroke} strokeWidth="0.8" opacity="0.3"/>
      <line x1="310" y1="58" x2="210" y2="138" className={s.gAccentStroke} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.5"/>
      <rect x="244" y="94" width="36" height="14" rx="3" className={s.gCallout}/>
      <text x="262" y="105" textAnchor="middle" className={s.gAccentText}>83–112m</text>
      <circle cx="186" cy="152" r="28" className={s.gDangerZone} strokeDasharray="3 3"/>
      <rect x="142" y="108" width="80" height="14" rx="3" className={s.gDangerZone}/>
      <text x="182" y="119" textAnchor="middle" className={s.gDangerTextStrong}>NO PASS RECORDED</text>
      <text x="614" y="24" className={s.gLabel} textAnchor="middle">N ↑</text>
    </svg>
  );

  if (scenario === 'gps_gap') return (
    <svg viewBox="0 0 640 200" width="100%" className={s.gpsMap} data-state={accent}>
      <rect width="640" height="200" className={s.gBg}/>
      <pattern id="g3" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" className={s.gGrid}/></pattern>
      <rect width="640" height="200" fill="url(#g3)"/>
      <rect x="0" y="80" width="640" height="24" className={s.gRoad}/>
      <line x1="0" y1="92" x2="640" y2="92" className={s.gRoadLine} strokeDasharray="18 12"/>
      <text x="14" y="77" className={s.gLabel}>CHURCH TCE</text>
      <rect x="230" y="64" width="200" height="56" rx="4" className={s.gWarnZone} strokeDasharray="4 3"/>
      <text x="330" y="77" textAnchor="middle" className={s.gWarnTextStrong}>GPS GAP 08:41–08:47</text>
      <text x="330" y="89" textAnchor="middle" className={s.gWarnText}>6 min · no position data</text>
      <path d="M 0,91 C 50,90 100,90 160,90 S 210,90 230,90" className={s.gTrack}/>
      <path d="M 430,91 C 460,91 510,92 560,93 S 610,94 640,95" className={s.gTrack}/>
      {[35,90,148,205].map(x=><circle key={x} cx={x} cy={91} r="3.5" className={s.gPoint}/>)}
      {[435,495,555,608].map((x,i)=><circle key={x} cx={x} cy={[91,92,93,95][i]} r="3.5" className={s.gPoint}/>)}
      <line x1="310" y1="104" x2="310" y2="148" className={s.gConnector} strokeDasharray="4 4"/>
      <rect x="282" y="148" width="56" height="36" rx="3" className={s.gWarnZone}/>
      <path d="M 285,158 L 310,148 L 335,158" className={s.gWarnStroke}/>
      <text x="310" y="176" textAnchor="middle" className={s.gWarnText}>PROPERTY</text>
      <text x="310" y="122" textAnchor="middle" className={s.gWarnGlyph}>?</text>
      <circle cx="205" cy="90" r="5" className={s.gWarnDot} opacity="0.85"/>
      <text x="180" y="77" className={s.gWarnText}>Last GPS 08:41</text>
      <circle cx="435" cy="91" r="5" className={s.gWarnDot} opacity="0.85"/>
      <text x="440" y="79" className={s.gWarnText}>GPS resumed 08:47</text>
      <text x="614" y="24" className={s.gLabel} textAnchor="middle">N ↑</text>
    </svg>
  );

  return (
    <svg viewBox="0 0 640 200" width="100%" className={s.gpsMap} data-state={accent}>
      <rect width="640" height="200" className={s.gBg}/>
      <pattern id="g4" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" className={s.gGrid}/></pattern>
      <rect width="640" height="200" fill="url(#g4)"/>
      <rect x="294" y="80" width="52" height="40" rx="3" className={s.gBlock}/>
      <path d="M 297,90 L 320,80 L 343,90" className={s.gInfoStroke}/>
      <text x="320" y="112" textAnchor="middle" className={s.gLabel}>PROPERTY</text>
      <rect x="0" y="0" width="640" height="200" className={s.gVeil}/>
      <text x="320" y="90" textAnchor="middle" className={s.gEmptyTitle}>No GPS coverage recorded</text>
      <text x="320" y="112" textAnchor="middle" className={s.gEmptyText}>Vehicle location data unavailable for this date</text>
    </svg>
  );
}

// ─── Engine Evidence Panel ────────────────────────────────────────────────────

function EngineResultPanel({ result }: { result: VerificationResult }) {
  const meta = STATUS_META[result.status] ?? FALLBACK_META;
  const conf = result.confidence;

  const checks = [
    { label: 'GPS pass',       on: result.passDetected },
    { label: 'Stop / dwell',   on: result.stopDetected },
    { label: 'Lift / RFID',    on: result.liftDetected },
    { label: 'In window',      on: !!result.inServiceWindow },
    { label: 'GPS gap',        on: result.gpsGapSec !== null, warn: true },
    { label: 'Exception',      on: result.exceptionDetected, warn: true },
  ];

  return (
    <div className={s.resultCard} data-state={meta.state}>
      <div className={s.resultHeader} data-state={meta.state}>
        <div className={s.resultTitle}>
          <span className={s.statusDot} data-state={meta.state} aria-hidden="true"/>
          <span className={s.statusLabel} data-state={meta.state}>{meta.label}</span>
          <span className={s.statusMeta}>— Engine result</span>
        </div>
        <span className={s.chip} data-tone={confTone(conf) ?? 'success'}>
          {conf}% confidence
        </span>
      </div>
      <div className={s.confBar} aria-hidden="true">
        <div className={s.confFill} data-tone={confTone(conf)} style={{ width: `${conf}%` }}/>
      </div>
      <div className={s.resultBody}>
        {/* Evidence checks */}
        <ul className={s.checkList}>
          {checks.map(({ label, on, warn }) => (
            <li key={label} className={s.chip} data-tone={on ? (warn ? 'warning' : 'success') : undefined}>
              {on ? (warn ? '⚠ ' : '✓ ') : '— '}{label}
            </li>
          ))}
          {result.nearestGpsM !== null && (
            <li className={s.chipMeta}>
              Nearest GPS: {result.nearestGpsM}m
            </li>
          )}
          {result.stopDurationSec !== null && (
            <li className={s.chipMeta}>
              Dwell: {result.stopDurationSec}s
            </li>
          )}
        </ul>
        {/* Evidence summary */}
        <p className={s.summary}>
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
    <div className={s.resultCard} data-state={meta.state}>
      <div className={s.resultHeader} data-state={meta.state}>
        <div className={s.resultTitle}>
          <span className={s.statusDot} data-state={meta.state} aria-hidden="true"/>
          <span className={s.statusLabel} data-state={meta.state}>{meta.label}</span>
          <span className={s.statusMeta}>— Static reference data</span>
        </div>
        <span className={s.chip} data-tone={confTone(v.confidence) ?? 'success'}>
          {v.confidence}% confidence
        </span>
      </div>
      <div className={s.confBar} aria-hidden="true">
        <div className={s.confFill} data-tone={confTone(v.confidence)} style={{ width: `${v.confidence}%` }}/>
      </div>
      <dl className={s.factGridWide}>
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
          <div key={label} className={s.fact}>
            <dt className={s.factLabel}>{label}</dt>
            <dd className={s.factValue} data-tone={ok ? 'success' : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─── Intelligence Summary ─────────────────────────────────────────────────────

function IntelligenceSummary({ summary, action, level }: { summary: string; action: string | null; level: PropertyData['intelligence_level'] }) {
  const map = {
    good:    { state: 'success', title: 'Service Confirmed' },
    warning: { state: 'warning', title: 'Verification Inconclusive' },
    alert:   { state: 'error',   title: 'Service Issue Identified' },
  } as const;
  const m = map[level];
  return (
    <Banner state={m.state} title={`Intelligence Summary · ${m.title}`}>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{summary}</p>
      {action && (
        <p style={{ margin: '8px 0 0', fontWeight: 600 }}>
          <span aria-hidden="true">→ </span>{action}
        </p>
      )}
    </Banner>
  );
}

// ─── Assets Panel ─────────────────────────────────────────────────────────────

function AssetsPanel({ assets, planned }: { assets: PropertyData['assets']; planned: PropertyData['planned_services'] }) {
  const lid = (c: string) => c.includes('Red') ? 'red' : c.includes('Yellow') ? 'yellow' : c.includes('Green') ? 'green' : undefined;
  const assetState = (st: string): SemanticState => st === 'active' ? 'success' : st === 'damaged' ? 'warning' : st === 'missing' ? 'error' : 'inactive';
  return (
    <Panel title="Bin Assets">
      <ul className={s.assetList}>
        {assets.map(a => (
          <li key={a.rfid} className={s.asset}>
            <span className={s.lid} data-lid={lid(a.colour)} aria-hidden="true"/>
            <div className={s.assetText}>
              <p className={s.assetName}>{a.type}</p>
              <p className={s.assetMeta}>{a.volume} · {a.colour}</p>
            </div>
            {a.rfid && (
              <span className={`${s.tag} ${s.mono}`}>
                {a.rfid}
              </span>
            )}
            <Badge state={assetState(a.status)}>{a.status}</Badge>
          </li>
        ))}
      </ul>
      <div className={s.plannedSection}>
        <h3 className={s.subTitle}>Scheduled Services</h3>
        <ul className={s.plannedList}>
          {planned.map(p => (
            <li key={p.service_type} className={s.planned}>
              <p className={s.plannedName}>{p.service_type}</p>
              <p className={s.plannedMeta}>{p.schedule} · {p.window}</p>
              <p className={s.plannedNext}>Next: {p.next_date}</p>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PropertyClient({ data, engineResult }: { data: PropertyData; propertyId: string; engineResult?: VerificationResult | null }) {
  // Use engine result for the status badge if available
  const displayStatus = engineResult?.status ?? data.verification.status;
  const displayConfidence = engineResult?.confidence ?? data.verification.confidence;
  const statusMeta = STATUS_META[displayStatus] ?? FALLBACK_META;

  return (
    <main className={s.page}>
      <div className={`${s.inner} ${s.innerNarrow}`}>

        {/* Header */}
        <PageHeader
          eyebrow={
            <nav aria-label="Breadcrumb">
              <ol className={s.breadcrumb}>
                <li><Link href="/dashboard/wste" className={s.breadcrumbLink}>← WSTe</Link></li>
                <li aria-hidden="true">/</li>
                <li aria-current="page">Property Intelligence</li>
              </ol>
            </nav>
          }
          title={data.address}
          description={<>{data.suburb} · {data.zone} · <span className={s.mono}>{data.account_ref}</span></>}
          actions={
            <div className={s.statusPill} data-state={statusMeta.state}>
              <span className={s.statusDot} data-state={statusMeta.state} data-pulse="true" aria-hidden="true"/>
              <span className={s.statusLabel} data-state={statusMeta.state}>{statusMeta.label}</span>
              <span className={s.statusMeta}>{displayConfidence}% confidence</span>
              {engineResult && <span className={s.tag}>ENGINE</span>}
            </div>
          }
        />

        {/* Key question */}
        <p className={s.question}>
          What happened here, when did it happen, and what evidence proves it?
        </p>

        {/* Demo disclaimer */}
        <Banner state="warning" title="Demo data only — not live GPS evidence" />

        {/* Intelligence Summary */}
        <IntelligenceSummary summary={data.intelligence_summary} action={data.intelligence_action} level={data.intelligence_level} />

        {/* Two-column: verification + assets */}
        <div className={s.twoCol}>
          <div className={s.stack}>
            {engineResult && <EngineResultPanel result={engineResult} />}
            <VerificationHero v={data.verification} />
            <section className={s.card} style={{ overflow: 'hidden' }} aria-labelledby="wste-gps-evidence-title">
              <div className={s.cardHeader}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={s.icon} aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <h2 id="wste-gps-evidence-title" className={s.sectionTitle}>GPS Evidence — Latest Run</h2>
                <Badge state="warning" dot={false}>DEMO</Badge>
                <span className={s.pushRight}>
                  <Badge state={statusMeta.state}>
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
                  </Badge>
                </span>
              </div>
              <GPSMap scenario={data.verification.scenario} status={data.verification.status} />
            </section>
          </div>
          <AssetsPanel assets={data.assets} planned={data.planned_services} />
        </div>

        {/* Service Timeline — full width */}
        <ServiceTimeline events={data.service_events} title="Service & Evidence Timeline" />
      </div>
    </main>
  );
}
