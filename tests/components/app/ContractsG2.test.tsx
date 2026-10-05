import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';

// G2 behaviour-contract pins for the remaining-visual-islands pass:
// WSTe overview / property detail / ServiceTimeline, Service Requests,
// Social Intelligence and Integrations. Every expected value below is derived
// from the BASE implementation (commit ecb5b03) — the helper functions marked
// "BASE LOGIC" are copied verbatim from the base files — so any behavioural
// drift in the visual pass fails here. Synthetic fixtures only; fetch is a
// stub, confirm/window.open are stubs, nothing real is synced/created/deleted.

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push, refresh }),
}));

const fireHelena = vi.fn();
vi.mock('@/lib/state/useAppStore', () => {
  // stable function identities, like the real zustand store (a fresh vi.fn()
  // per render would re-run HlnaInsightBanner's load effect on every render)
  const setOrbAlert = vi.fn();
  const useAppStore = () => ({ fireHelena, setOrbAlert });
  useAppStore.getState = () => ({ fireHelena, setChatOpen: vi.fn() });
  return { useAppStore };
});

// recharts is replaced by capturing stubs so the exact data arrays handed to
// each chart can be compared with the base computation.
const charts = vi.hoisted(() => ({ calls: [] as Array<{ kind: string; props: Record<string, unknown> }> }));
vi.mock('recharts', () => {
  // eslint-disable-next-line react/display-name -- chart stub factory
  const pass = (kind: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    charts.calls.push({ kind, props });
    return <div data-chart={kind}>{props.children}</div>;
  };
  const leaf = (kind: string) => (props: Record<string, unknown>) => {
    charts.calls.push({ kind, props });
    return null;
  };
  return {
    ResponsiveContainer: pass('ResponsiveContainer'),
    BarChart: pass('BarChart'),
    PieChart: pass('PieChart'),
    Pie: pass('Pie'),
    Bar: leaf('Bar'),
    Cell: leaf('Cell'),
    XAxis: leaf('XAxis'),
    YAxis: leaf('YAxis'),
    Tooltip: leaf('Tooltip'),
    CartesianGrid: leaf('CartesianGrid'),
  };
});

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { default: WSTEClient } = await import('@/app/dashboard/wste/WSTEClient');
const { default: PropertyClient } = await import('@/app/dashboard/wste/property/[id]/PropertyClient');
const { default: ServiceRequestsClient } = await import('@/app/dashboard/service-requests/ServiceRequestsClient');
const { default: SocialClient } = await import('@/app/dashboard/social/SocialClient');
const { default: IntegrationsClient } = await import('@/app/dashboard/integrations/IntegrationsClient');

function renderUi(ui: React.ReactElement) {
  localStorage.clear();
  localStorage.setItem('bb-theme', 'light');
  return renderBrainbase(<ThemeProvider>{ui}</ThemeProvider>, { theme: 'light' });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  push.mockReset(); refresh.mockReset(); fireHelena.mockReset();
  charts.calls.length = 0;
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

// ── BASE LOGIC (verbatim from ecb5b03) ───────────────────────────────────────

// app/dashboard/wste/WSTEClient.tsx (base)
function basePropertyHref(address: string) {
  return `/dashboard/wste/property/${encodeURIComponent(address.toLowerCase().replace(/\s+/g, '-'))}`;
}
function baseFmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function baseFmtDate(s: string): string {
  try { return new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); } catch { return s; }
}
// app/dashboard/service-requests/ServiceRequestsClient.tsx (base)
const baseFmt$ = (n: number) => n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${n}`;

type SR = { request_id: string; service_type: string; suburb: string; month: string; status: string; priority: string; days_open: number; cost: number };
function baseTrend(rows: SR[], monthOrder: string[]) {
  const monthsInData = [...new Set(rows.map(r => r.month))];
  const ordered = monthOrder.filter(m => monthsInData.includes(m));
  return ordered.map(month => {
    const monthRows = rows.filter(r => r.month === month);
    return {
      month,
      Open:    monthRows.filter(r => r.status === 'Open').length,
      Closed:  monthRows.filter(r => r.status === 'Closed').length,
      Pending: monthRows.filter(r => r.status === 'Pending').length,
    };
  });
}
function baseSuburb(rows: SR[]) {
  const map = new Map<string, { open: number; high: number; avg: number; count: number; sumDays: number }>();
  for (const r of rows) {
    const e = map.get(r.suburb) ?? { open: 0, high: 0, avg: 0, count: 0, sumDays: 0 };
    e.count++;
    if (r.status === 'Open')    e.open++;
    if (r.priority === 'High')  e.high++;
    e.sumDays += r.days_open;
    map.set(r.suburb, e);
  }
  return [...map.entries()]
    .map(([suburb, s]) => ({ suburb, open: s.open, high: s.high, avgDays: Math.round(s.sumDays / s.count) }))
    .sort((a, b) => b.open - a.open);
}
function baseType(rows: SR[]) {
  const map = new Map<string, { count: number; open: number; cost: number }>();
  for (const r of rows) {
    const e = map.get(r.service_type) ?? { count: 0, open: 0, cost: 0 };
    e.count++;
    if (r.status === 'Open') e.open++;
    e.cost += r.cost;
    map.set(r.service_type, e);
  }
  return [...map.entries()]
    .map(([type, s]) => ({ type, count: s.count, open: s.open, cost: s.cost }))
    .sort((a, b) => b.count - a.count);
}
function baseFilter(rows: SR[], statusFilter: string, priorityFilter: string) {
  return rows.filter(r => {
    if (statusFilter   !== 'All' && r.status   !== statusFilter)   return false;
    if (priorityFilter !== 'All' && r.priority !== priorityFilter) return false;
    return true;
  });
}

// ── DOM helpers (structure-agnostic: work on base and current markup) ───────

/** The value shown next to a KPI/fact label (label → sibling, or label's parent → sibling). */
function valueFor(label: string, root: HTMLElement = document.body): string {
  const cands = within(root).getAllByText(label).filter(el => el.tagName !== 'BUTTON' && !el.closest('button, table, [role="tablist"]'));
  for (const el of cands) {
    for (const v of [el.nextElementSibling, el.parentElement?.nextElementSibling]) {
      if (v && v.textContent && v.textContent.trim()) return v.textContent.trim();
    }
  }
  throw new Error(`no value found for label "${label}"`);
}
function bodyRows(table: HTMLElement): string[][] {
  return [...table.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => (td.textContent ?? '').trim()));
}
function lastChart(kind: string) {
  const hits = charts.calls.filter(c => c.kind === kind);
  return hits[hits.length - 1]?.props;
}

// ════════════════════════════════════════════════════════════════════════════
// WSTe overview
// ════════════════════════════════════════════════════════════════════════════

const KPIS = { total_gps_points: 1_234_567, vehicles_tracked: 7, runs_analysed: 1500, tickets_matched: 999, exceptions_identified: 3, verification_rate: 96.5 };
const RUNS = [
  { id: 'r1', run_date: '2025-01-02', vehicle_registration: 'TEST001', driver: 'A. Driver', route_name: 'Route A', suburb: 'Alpha', gps_points: 1500, tickets_matched: 20, exceptions_count: 0, verified: true, completion_pct: 100 },
  { id: 'r2', run_date: '2025-01-03', vehicle_registration: 'TEST002', driver: 'B. Driver', route_name: 'Route B', suburb: 'Beta', gps_points: 900, tickets_matched: 21, exceptions_count: 6, verified: false, completion_pct: 85 },
  { id: 'r3', run_date: '2025-01-04', vehicle_registration: 'TEST003', driver: 'C. Driver', route_name: 'Route C', suburb: 'Gamma', gps_points: 2_500_000, tickets_matched: 5, exceptions_count: 2, verified: true, completion_pct: 93 },
];
const EXCEPTIONS = [
  { id: 'e1', run_date: '2025-01-03', vehicle_registration: 'TEST002', address: '1 Test St', suburb: 'Beta', exception_type: 'Missed Service', severity: 'high' as const, resolved: false },
  { id: 'e2', run_date: '2025-01-03', vehicle_registration: 'TEST002', address: "12/3  O'Brien   Street", suburb: 'Beta', exception_type: 'GPS Gap', severity: 'medium' as const, resolved: false },
  { id: 'e3', run_date: '2025-01-04', vehicle_registration: 'TEST003', address: 'Unit 4, 5 Ünïcode Rd #2', suburb: 'Gamma', exception_type: 'Wrong Order', severity: 'low' as const, resolved: true },
];
const VEHICLES = [
  { id: 'v1', registration: 'TEST001', make: 'MakeA', model: 'M1', vehicle_type: 'Rear Loader', depot: 'Depot A', active: true },
  { id: 'v2', registration: 'TEST002', make: 'MakeB', model: 'M2', vehicle_type: 'Side Loader', depot: 'Depot B', active: true },
];

describe('G2 contract — WSTe overview', () => {
  it('fires no request on mount', () => {
    renderUi(<WSTEClient isDemo kpis={KPIS} runs={RUNS} exceptions={EXCEPTIONS} vehicles={VEHICLES} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('KPI values are the base fmt() of each kpi field', () => {
    renderUi(<WSTEClient isDemo kpis={KPIS} runs={RUNS} exceptions={EXCEPTIONS} vehicles={VEHICLES} />);
    expect(valueFor('GPS Points')).toBe(baseFmt(KPIS.total_gps_points));
    expect(valueFor('Vehicles Tracked')).toBe(baseFmt(KPIS.vehicles_tracked));
    expect(valueFor('Runs Analysed')).toBe(baseFmt(KPIS.runs_analysed));
    expect(valueFor('Tickets Matched')).toBe(baseFmt(KPIS.tickets_matched));
    expect(valueFor('Exceptions')).toBe(baseFmt(KPIS.exceptions_identified));
    expect(valueFor('Verification Rate')).toBe(`${baseFmt(KPIS.verification_rate)}%`);
  });

  it('open-exception banner text and vehicle strip fields match base', () => {
    renderUi(<WSTEClient isDemo kpis={KPIS} runs={RUNS} exceptions={EXCEPTIONS} vehicles={VEHICLES} />);
    // base: `${open} open exception${s}` + ` — ${high} high severity` + ` requiring review`
    expect(screen.getByText('2 open exceptions — 1 high severity requiring review')).toBeInTheDocument();
    expect(screen.getByText(`Active Fleet — ${VEHICLES.length} vehicles`)).toBeInTheDocument();
    for (const v of VEHICLES) {
      expect(screen.getByText(`${v.make} ${v.model} · ${v.vehicle_type}`)).toBeInTheDocument();
      expect(screen.getByText(v.depot)).toBeInTheDocument();
    }
    expect(screen.getByText(/Demo data only — not live GPS evidence\./)).toBeInTheDocument();
  });

  it('runs table renders every base field per run; status is written, not colour-only', () => {
    renderUi(<WSTEClient isDemo={false} kpis={KPIS} runs={RUNS} exceptions={[]} vehicles={VEHICLES} />);
    const table = screen.getAllByRole('table')[0];
    const head = [...table.querySelectorAll('thead th')].map(th => th.textContent?.trim());
    expect(head).toEqual(['Date', 'Vehicle', 'Driver', 'Route / Suburb', 'GPS Pts', 'Tickets', 'Exceptions', 'Complete', 'Status']);
    expect(bodyRows(table)).toEqual(RUNS.map(r => [
      baseFmtDate(r.run_date), r.vehicle_registration, r.driver, `${r.route_name}${r.suburb}`,
      baseFmt(r.gps_points), String(r.tickets_matched), String(r.exceptions_count > 0 ? r.exceptions_count : 0),
      `${r.completion_pct}%`, r.verified ? 'Verified' : 'Review',
    ]));
  });

  it('exceptions tab: fields, severity/status text, show-resolved filter and property hrefs are base-identical', () => {
    renderUi(<WSTEClient isDemo kpis={KPIS} runs={RUNS} exceptions={EXCEPTIONS} vehicles={VEHICLES} />);
    fireEvent.click(screen.getByText('Exceptions (2)'));
    const sevLabel = { high: 'High', medium: 'Medium', low: 'Low' } as const;
    const expectRows = (list: typeof EXCEPTIONS) => {
      const table = screen.getByRole('table');
      expect(bodyRows(table)).toEqual(list.map(e => [
        baseFmtDate(e.run_date), e.vehicle_registration, e.address, e.suburb, e.exception_type,
        sevLabel[e.severity], e.resolved ? 'Resolved' : 'Open',
      ]));
      const links = [...table.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]);
      expect(links).toEqual(list.map(e => [e.address, basePropertyHref(e.address)]));
    };
    expectRows(EXCEPTIONS.filter(e => !e.resolved));
    fireEvent.click(screen.getByLabelText('Show resolved'));
    expect(screen.getByText('Exceptions (3)')).toBeInTheDocument();
    expectRows(EXCEPTIONS);
    // Concrete href spot-checks (base encoding of whitespace runs, "/", "'", "#", unicode).
    expect(basePropertyHref("12/3  O'Brien   Street")).toBe("/dashboard/wste/property/12%2F3-o'brien-street");
    expect(screen.getByText('Unit 4, 5 Ünïcode Rd #2').closest('a')).toHaveAttribute('href', '/dashboard/wste/property/unit-4%2C-5-%C3%BCn%C3%AFcode-rd-%232');
  });

  it('empty exceptions copy is unchanged', () => {
    renderUi(<WSTEClient isDemo kpis={KPIS} runs={RUNS} exceptions={[EXCEPTIONS[2]]} vehicles={VEHICLES} />);
    fireEvent.click(screen.getByText('Exceptions (0)'));
    expect(screen.getByText('No open exceptions — all clear.')).toBeInTheDocument();
  });

  it('address lookup: Enter triggers the same 800ms simulated lookup; not-found branch; href uses base builder', () => {
    vi.useFakeTimers();
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.1); // base: found = random > 0.25 → not found
    renderUi(<WSTEClient isDemo={false} kpis={KPIS} runs={RUNS} exceptions={[]} vehicles={VEHICLES} />);
    const input = screen.getByPlaceholderText('e.g. 14 Edmund Ave, Trinity Gardens');
    fireEvent.change(input, { target: { value: '  Flat 2/10 Main  Rd ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(799); });
    expect(screen.queryByText('No GPS record found for this address')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('No GPS record found for this address')).toBeInTheDocument();

    rnd.mockReturnValue(0.9);
    fireEvent.change(input, { target: { value: 'Flat 2/10 Main  Rd' } });
    expect(screen.queryByText('No GPS record found for this address')).toBeNull(); // typing clears result
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText('Service Verified')).toBeInTheDocument();
    expect(valueFor('GPS Passes')).toBe(String(Math.floor(0.9 * 6) + 1));
    expect(valueFor('Last Service')).toBe('28 Apr 2025');
    expect(valueFor('Vehicle')).toBe('S321JKL');
    expect(valueFor('Driver')).toBe('T. Walsh');
    expect(screen.getByText('View Property Intelligence →').closest('a')).toHaveAttribute('href', basePropertyHref('Flat 2/10 Main  Rd'));
    expect(basePropertyHref('Flat 2/10 Main  Rd')).toBe('/dashboard/wste/property/flat-2%2F10-main-rd');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WSTe property detail + ServiceTimeline
// ════════════════════════════════════════════════════════════════════════════

const PROPERTY = {
  address: '1 Test St', suburb: 'Beta', zone: 'Zone 1', account_ref: 'ACC-0001', lat: 0, lng: 0,
  assets: [
    { rfid: 'BIN-TEST-1', type: 'General Waste', volume: '140L', colour: 'Red lid', status: 'active' as const },
    { rfid: 'BIN-TEST-2', type: 'Recycling', volume: '240L', colour: 'Yellow lid', status: 'damaged' as const },
  ],
  planned_services: [{ service_type: 'Kerbside Weekly', schedule: 'Weekly', run: 'R1', window: '06:00–10:00', next_date: '2025-01-10' }],
  verification: {
    status: 'likely_missed' as const, scenario: 'route_bypass' as const, vehicle_reg: 'TEST002', driver: 'B. Driver',
    run_name: 'Route B', pass_time: null, distance_m: 90, speed_kmh: 30, confidence: 30, linked_exception: 'Missed Service', gps_points_nearby: 0,
  },
  service_events: [
    { id: 's1', date: '2025-01-03', time: '09:12', service_type: 'bin_collection' as const, service_name: 'Weekly collection', verification_status: 'likely_missed' as const, vehicle_reg: 'TEST002', driver: 'B. Driver', confidence: 30, evidence: [{ type: 'gps' as const, description: 'No pass within 80m' }, { type: 'rfid' as const }], details: [{ label: 'Run name', value: 'Route B' }], notes: 'Synthetic note' },
    { id: 's2', date: '2024-12-27', service_type: 'hard_waste' as const, service_name: 'Hard waste pickup', verification_status: 'verified' as const, evidence: [], details: [] },
  ],
  intelligence_summary: 'Synthetic summary.', intelligence_action: 'Synthetic action', intelligence_level: 'alert' as const,
};
const ENGINE = {
  status: 'likely_missed' as const, confidence: 28, confidenceLabel: 'low' as const, passDetected: false, stopDetected: false,
  liftDetected: false, exceptionDetected: true, nearestGpsM: 95, passTimeIso: null, stopDurationSec: 12, vehicleMatch: null,
  inServiceWindow: true, gpsGapSec: null, evidenceSummary: 'Synthetic engine summary.', matchedEvidence: [],
};

describe('G2 contract — WSTe property detail', () => {
  it('fires no request on mount; header fields and breadcrumb href match base', () => {
    renderUi(<PropertyClient data={PROPERTY} propertyId="1-test-st" engineResult={ENGINE} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 Test St');
    expect(screen.getByText('← WSTe').closest('a')).toHaveAttribute('href', '/dashboard/wste');
    expect(screen.getByText('Property Intelligence')).toBeInTheDocument();
    expect(screen.getByText('ACC-0001')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Beta · Zone 1');
    // header status uses engine status + engine confidence when an engine result exists
    expect(screen.getAllByText('Likely Missed').length).toBeGreaterThanOrEqual(3); // header, engine panel, hero (+ timeline)
    expect(screen.getAllByText('28% confidence')).toHaveLength(2); // header + engine panel
    expect(screen.getByText('ENGINE')).toBeInTheDocument();
    expect(screen.getByText('What happened here, when did it happen, and what evidence proves it?')).toBeInTheDocument();
  });

  it('without an engine result the header falls back to static verification status/confidence', () => {
    renderUi(<PropertyClient data={{ ...PROPERTY, verification: { ...PROPERTY.verification, status: 'verified' as never, scenario: 'gps_gap' as const, confidence: 81 } }} propertyId="x" engineResult={null} />);
    expect(screen.getAllByText('81% confidence')).toHaveLength(2); // header + hero
    expect(screen.queryByText('ENGINE')).toBeNull();
    expect(screen.getByText('Data gap')).toBeInTheDocument(); // scenario label (base mapping)
  });

  it('engine panel checks, nearest/dwell and summary are written as base', () => {
    renderUi(<PropertyClient data={PROPERTY} propertyId="1-test-st" engineResult={ENGINE} />);
    for (const t of ['— GPS pass', '— Stop / dwell', '— Lift / RFID', '✓ In window', '— GPS gap', '⚠ Exception']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getByText('Nearest GPS: 95m')).toBeInTheDocument();
    expect(screen.getByText('Dwell: 12s')).toBeInTheDocument();
    expect(screen.getByText('Synthetic engine summary.')).toBeInTheDocument();
    expect(screen.getByText('— Engine result')).toBeInTheDocument();
    expect(screen.getByText('Route bypassed')).toBeInTheDocument(); // engine likely_missed → 'Route bypassed'
  });

  it('verification hero fields and values match base', () => {
    renderUi(<PropertyClient data={PROPERTY} propertyId="1-test-st" engineResult={ENGINE} />);
    expect(screen.getByText('— Static reference data')).toBeInTheDocument();
    expect(screen.getByText('30% confidence')).toBeInTheDocument();
    const v = PROPERTY.verification;
    expect(valueFor('Vehicle')).toBe(v.vehicle_reg);
    expect(valueFor('Driver')).toBe(v.driver);
    expect(valueFor('Run')).toBe(v.run_name);
    expect(valueFor('Pass Time')).toBe('Not recorded');
    expect(valueFor('Distance')).toBe('90m');
    expect(valueFor('Speed')).toBe('30 km/h');
    expect(valueFor('Exception')).toBe('Missed Service');
    expect(valueFor('GPS Nearby')).toBe('0 points');
  });

  it('intelligence summary, assets and planned services render the base fields', () => {
    renderUi(<PropertyClient data={PROPERTY} propertyId="1-test-st" engineResult={ENGINE} />);
    expect(screen.getByText('Intelligence Summary · Service Issue Identified')).toBeInTheDocument();
    expect(screen.getByText('Synthetic summary.')).toBeInTheDocument();
    expect(screen.getByText('Synthetic action')).toBeInTheDocument();
    for (const a of PROPERTY.assets) {
      expect(screen.getByText(a.type)).toBeInTheDocument();
      expect(screen.getByText(`${a.volume} · ${a.colour}`)).toBeInTheDocument();
      expect(screen.getByText(a.rfid)).toBeInTheDocument();
      expect(screen.getByText(a.status)).toBeInTheDocument(); // status is written
    }
    expect(screen.getByText('Bin Assets')).toBeInTheDocument();
    expect(screen.getByText('Scheduled Services')).toBeInTheDocument();
    expect(screen.getByText('Kerbside Weekly')).toBeInTheDocument();
    expect(screen.getByText('Weekly · 06:00–10:00')).toBeInTheDocument();
    expect(screen.getByText('Next: 2025-01-10')).toBeInTheDocument();
    expect(screen.getByText('Demo data only — not live GPS evidence')).toBeInTheDocument();
  });

  it('ServiceTimeline: event header fields, chips, status text, filter + expand behaviour match base', () => {
    renderUi(<PropertyClient data={PROPERTY} propertyId="1-test-st" engineResult={ENGINE} />);
    expect(screen.getByText('Service & Evidence Timeline (2)')).toBeInTheDocument();
    const t1 = screen.getByText('Weekly collection').closest('button')!;
    expect(t1.textContent).toBe(`Bin CollectionWeekly collection${baseFmtDate('2025-01-03')} · 09:12Likely Missed`);
    const t2 = screen.getByText('Hard waste pickup').closest('button')!;
    expect(t2.textContent).toBe(`Hard WasteHard waste pickup${baseFmtDate('2024-12-27')}Verified`);
    // chips row (always visible)
    expect(screen.getByText('GPS')).toBeInTheDocument();
    expect(screen.getByText('RFID')).toBeInTheDocument();
    expect(screen.getByText('30% conf.')).toBeInTheDocument();
    expect(document.body.textContent).toContain('TEST002 · B. Driver');
    // expand
    expect(screen.queryByText('Synthetic note')).toBeNull();
    fireEvent.click(t1);
    expect(valueFor('Run name')).toBe('Route B');
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('No pass within 80m')).toBeInTheDocument();
    expect(screen.getByText('Synthetic note')).toBeInTheDocument();
    fireEvent.click(t1);
    expect(screen.queryByText('Synthetic note')).toBeNull();
    // filters: base order, toggle, clear
    const filterNames = ['Bin Collection', 'Hard Waste'];
    const filterButtons = screen.getAllByRole('button').filter(b => filterNames.includes((b.textContent ?? '').trim()));
    expect(filterButtons.map(b => b.textContent?.trim())).toEqual(filterNames);
    fireEvent.click(filterButtons[1]);
    expect(screen.getByText('Service & Evidence Timeline (1)')).toBeInTheDocument();
    expect(screen.queryByText('Weekly collection')).toBeNull();
    fireEvent.click(filterButtons[1]);
    expect(screen.getByText('Service & Evidence Timeline (2)')).toBeInTheDocument();
    fireEvent.click(filterButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Service & Evidence Timeline (2)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Service Requests
// ════════════════════════════════════════════════════════════════════════════

const SUBURBS = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10'];
const TYPES = ['Missed Bin', 'Graffiti', 'Pothole', 'Dumping'];
const STATUSES = ['Open', 'Closed', 'Pending'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const MONTH_CYCLE = ['Mar', 'Jan', 'Feb', 'Zzz']; // Zzz is not in monthOrder → base drops it from the trend
const SR_ROWS: SR[] = Array.from({ length: 90 }, (_, i) => ({
  request_id: `SR-${String(i).padStart(3, '0')}`,
  service_type: TYPES[(i * 3) % 4],
  suburb: SUBURBS[(i * 7) % 10],
  month: MONTH_CYCLE[i % 4],
  status: STATUSES[i % 3],
  priority: PRIORITIES[Math.floor(i / 2) % 3],
  days_open: (i * 3) % 15,
  cost: i % 5 === 0 ? 1500 + i * 10 : 40 + i,
}));
const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

describe('G2 contract — Service Requests', () => {
  it('demo: no request on mount; KPI values match base', () => {
    renderUi(<ServiceRequestsClient isDemo uploadMeta={null} rows={SR_ROWS} monthOrder={MONTHS} />);
    expect(fetchMock).not.toHaveBeenCalled();
    const open = SR_ROWS.filter(r => r.status === 'Open');
    const closed = SR_ROWS.filter(r => r.status === 'Closed');
    const highPriOpen = open.filter(r => r.priority === 'High');
    const avg = open.reduce((s, r) => s + r.days_open, 0) / open.length;
    expect(valueFor('Avg Days Open')).toBe(avg > 0 ? avg.toFixed(1) : '—');
    expect(valueFor('Resolution Rate')).toBe(`${Math.round((closed.length / SR_ROWS.length) * 100)}%`);
    expect(valueFor('Pending')).toBe(String(SR_ROWS.filter(r => r.status === 'Pending').length));
    expect(valueFor('Total Cost')).toBe(baseFmt$(SR_ROWS.reduce((s, r) => s + r.cost, 0)));
    expect(valueFor('Open')).toBe(String(open.length));
    expect(screen.getByText(`${highPriOpen.length} high priority`)).toBeInTheDocument();
    expect(screen.getByText(`${highPriOpen.length} HIGH PRIORITY`)).toBeInTheDocument();
    expect(screen.getByText('Demo data — upload a spreadsheet to see real requests')).toBeInTheDocument();
    expect(screen.getByText('Upload a service requests spreadsheet to activate with real data.')).toBeInTheDocument();
  });

  it('live: the only request on mount is the base HLNA insight POST', async () => {
    renderUi(<ServiceRequestsClient isDemo={false} uploadMeta={{ fileName: 'synthetic.xlsx', recordCount: 1234, uploadedAt: '2025-01-01T00:00:00Z' } as never} rows={SR_ROWS} monthOrder={MONTHS} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls).toEqual([[
      '/api/hlna/insight',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dashboardType: 'service_requests' }) },
    ]]);
    expect(screen.getByText('synthetic.xlsx')).toBeInTheDocument();
    expect(screen.getByText('1,234 records')).toBeInTheDocument();
    expect(screen.getByText(`${SR_ROWS.length} total requests`)).toBeInTheDocument();
  });

  it('queue: status × priority filters, 80-row cap and row fields match base', () => {
    renderUi(<ServiceRequestsClient isDemo uploadMeta={null} rows={SR_ROWS} monthOrder={MONTHS} />);
    const check = (st: string, pr: string) => {
      const f = baseFilter(SR_ROWS, st, pr);
      expect(screen.getByText(`${f.length} of ${SR_ROWS.length}`)).toBeInTheDocument();
      const rows = bodyRows(screen.getAllByRole('table')[0]);
      expect(rows).toEqual(f.slice(0, 80).map(r => [
        r.request_id, r.service_type, r.suburb, r.month, r.status, r.priority, `${r.days_open}d`, baseFmt$(r.cost),
      ]));
      if (f.length > 80) expect(screen.getByText(`Showing 80 of ${f.length} — refine filters to narrow results`)).toBeInTheDocument();
      else expect(screen.queryByText(/^Showing 80 of/)).toBeNull();
    };
    check('All', 'All');
    const [statusAll, priorityAll] = screen.getAllByRole('button', { name: 'All' });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    check('Open', 'All');
    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    check('Open', 'High');
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    check('Pending', 'High');
    fireEvent.click(statusAll);
    check('All', 'High');
    fireEvent.click(screen.getByRole('button', { name: 'Low' }));
    check('All', 'Low');
    fireEvent.click(priorityAll);
    check('All', 'All');
  });

  it('chart inputs (trend / suburb / type) equal the base-computed series; tables match', () => {
    renderUi(<ServiceRequestsClient isDemo uploadMeta={null} rows={SR_ROWS} monthOrder={MONTHS} />);

    charts.calls.length = 0;
    fireEvent.click(screen.getByText('Monthly Trend'));
    expect(lastChart('BarChart')?.data).toEqual(baseTrend(SR_ROWS, MONTHS));
    expect(charts.calls.filter(c => c.kind === 'Bar').slice(-3).map(c => [c.props.dataKey, c.props.stackId]))
      .toEqual([['Closed', 's'], ['Pending', 's'], ['Open', 's']]);
    expect(lastChart('XAxis')?.dataKey).toBe('month');
    expect(screen.getByText('Request Volume by Month')).toBeInTheDocument();

    charts.calls.length = 0;
    fireEvent.click(screen.getByText('By Suburb'));
    const suburb = baseSuburb(SR_ROWS);
    expect(lastChart('BarChart')?.data).toEqual(suburb.slice(0, 8));
    expect(lastChart('BarChart')?.layout).toBe('vertical');
    expect(lastChart('Bar')?.dataKey).toBe('open');
    expect(lastChart('YAxis')?.dataKey).toBe('suburb');
    const subTable = screen.getAllByRole('table')[0];
    expect(bodyRows(subTable)).toEqual(suburb.map(r => [r.suburb, String(r.open), String(r.high), `${r.avgDays}d`]));

    charts.calls.length = 0;
    fireEvent.click(screen.getByText('By Type'));
    const types = baseType(SR_ROWS);
    const pie = lastChart('Pie')!;
    expect(pie.data).toEqual(types);
    expect(pie.dataKey).toBe('count');
    expect(pie.nameKey).toBe('type');
    const cells = charts.calls.filter(c => c.kind === 'Cell').length;
    expect(cells).toBeGreaterThan(0);
    expect(cells % types.length).toBe(0); // one Cell per type slice per render
    const label = pie.label as (p: unknown) => string;
    expect(label({ type: 'Graffiti', percent: 0.256 })).toBe('Graffiti 26%');
    const typeTable = screen.getAllByRole('table')[0];
    expect(bodyRows(typeTable)).toEqual(types.map(t => [t.type, String(t.count), String(t.open), baseFmt$(t.cost)]));
  });

  it('empty trend copy is unchanged', () => {
    renderUi(<ServiceRequestsClient isDemo uploadMeta={null} rows={SR_ROWS.filter(r => r.month === 'Zzz')} monthOrder={MONTHS} />);
    fireEvent.click(screen.getByText('Monthly Trend'));
    expect(screen.getByText('No trend data')).toBeInTheDocument();
    expect(lastChart('BarChart')).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Social Intelligence
// ════════════════════════════════════════════════════════════════════════════

const POSTS = [
  { id: 'p1', caption: 'Synthetic post', engagement_score: 400, like_count: 1234, comments_count: 2, permalink: 'https://example.test/p/1',
    comments: [
      { text: 'Synthetic complaint', sentiment: 'negative', username: 'tester' },
      { text: 'Synthetic urgent', sentiment: 'neutral', urgency: true, author_name: 'Urgent Person' },
      { text: 'Synthetic praise', sentiment: 'positive', username: 'fan' },
    ] },
];
const INSIGHTS = [
  { id: 'n1', title: 'Synthetic insight', summary: 'Synthetic insight summary', confidence: 'high', recommended_action: 'Do a thing', evidence_json: ['Evidence one'] },
  { id: 'n2', title: 'Second insight', summary: 'Second summary', confidence: 'Low' },
];
const STATS = { post_count: 7, avg_engagement: 400.4, avg_likes: 12.6, avg_comments: 3.25 };
const COMMENT_STATS = { total_comments: 8, positive_count: 5, urgent_count: 4 };

function socialResponder(overrides: Record<string, () => Response> = {}) {
  return async (url: string) => {
    if (overrides[url]) return overrides[url]();
    if (url === '/api/social/posts?limit=25') return new Response(JSON.stringify({ posts: POSTS, account: { updated_at: new Date().toISOString() } }), { status: 200 });
    if (url === '/api/social/insights') return new Response(JSON.stringify({ insights: INSIGHTS, stats: STATS, commentStats: COMMENT_STATS }), { status: 200 });
    if (url === '/api/social/sync') return new Response(JSON.stringify({ synced: 3, comments: 2 }), { status: 200 });
    if (url === '/api/social/analyse') return new Response(JSON.stringify({ stored: 4 }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
}
const GETS = [['/api/social/posts?limit=25'], ['/api/social/insights']];

describe('G2 contract — Social Intelligence', () => {
  it('shows Loading… until both base GETs resolve; mount fires exactly those two GETs (no init)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const respond = socialResponder();
    fetchMock.mockImplementation(async (url: string) => { await gate; return respond(url); });
    renderUi(<SocialClient isDemo={false} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Connect Instagram')).toBeNull();
    await act(async () => { release(); });
    await screen.findByText('Synthetic insight');
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(fetchMock.mock.calls).toEqual(GETS);
  });

  it('KPI values, tab labels and insight accordion content match base', async () => {
    fetchMock.mockImplementation(socialResponder());
    renderUi(<SocialClient isDemo={false} />);
    await screen.findByText('Synthetic insight');
    expect(valueFor('Posts analysed')).toBe('7');
    expect(valueFor('Avg engagement')).toBe('400');
    expect(valueFor('Avg likes')).toBe('13');
    expect(valueFor('Avg comments')).toBe('3.3');
    expect(valueFor('Sentiment score')).toBe('63%');
    expect(valueFor('Need attention')).toBe('4');
    expect(screen.getByText('Insights (2)')).toBeInTheDocument();
    expect(screen.getByText('Feed (1)')).toBeInTheDocument();
    expect(screen.getByText('Comments — 4 urgent')).toBeInTheDocument();
    // first insight open by default, confidence written in upper case
    expect(screen.getByText('Synthetic insight summary')).toBeInTheDocument();
    expect(screen.getByText('· Evidence one')).toBeInTheDocument();
    expect(screen.getByText('Recommended action')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('LOW')).toBeInTheDocument();
    expect(screen.queryByText('Second summary')).toBeNull();
    fireEvent.click(screen.getByText('Second insight'));
    expect(screen.getByText('Second summary')).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
  });

  it('comments tab lists urgent/negative comments with written sentiment + base reply angle; feed shows post fields', async () => {
    fetchMock.mockImplementation(socialResponder());
    renderUi(<SocialClient isDemo={false} />);
    await screen.findByText('Synthetic insight');
    fireEvent.click(screen.getByText('Comments — 4 urgent'));
    expect(screen.getByText('2 comments needing attention')).toBeInTheDocument();
    expect(screen.getByText('Synthetic complaint')).toBeInTheDocument();
    expect(screen.getByText('Synthetic urgent')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic praise')).toBeNull();
    expect(screen.getByText('NEGATIVE')).toBeInTheDocument();
    expect(screen.getByText('URGENT')).toBeInTheDocument();
    expect(screen.getByText(/Apologise, offer explanation, direct to resolution channel\./)).toBeInTheDocument();
    expect(screen.getByText(/Acknowledge urgency, provide direct contact or timeline\./)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Feed (1)'));
    expect(screen.getByText('Synthetic post')).toBeInTheDocument();
    expect(screen.getByText(`♥ ${(1234).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText('💬 2')).toBeInTheDocument();
    expect(screen.getByText('▲ 400')).toBeInTheDocument();
    expect(screen.getByText('↗ View').closest('a')).toHaveAttribute('href', 'https://example.test/p/1');
    fireEvent.click(screen.getByText('3 comments'));
    expect(screen.getByText('Synthetic praise')).toBeInTheDocument();
  });

  it('Sync Now: POST /api/social/sync (method only), notice, then reloads via the two GETs', async () => {
    fetchMock.mockImplementation(socialResponder());
    renderUi(<SocialClient isDemo={false} />);
    await screen.findByText('Synthetic insight');
    fireEvent.click(screen.getByText('↻ Sync Now'));
    await screen.findByText('Synced 3 posts and 2 comments.');
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(5));
    expect(fetchMock.mock.calls).toEqual([...GETS, ['/api/social/sync', { method: 'POST' }], ...GETS]);
  });

  it('Sync failure shows the base error notice and does not reload', async () => {
    fetchMock.mockImplementation(socialResponder({ '/api/social/sync': () => new Response(JSON.stringify({ error: 'Boom' }), { status: 500 }) }));
    renderUi(<SocialClient isDemo={false} />);
    await screen.findByText('Synthetic insight');
    fireEvent.click(screen.getByText('↻ Sync Now'));
    await screen.findByText('Sync failed: Boom');
    expect(fetchMock.mock.calls).toEqual([...GETS, ['/api/social/sync', { method: 'POST' }]]);
  });

  it('Run HLNA Analysis: POST /api/social/analyse (method only), notice, reload', async () => {
    fetchMock.mockImplementation(socialResponder());
    renderUi(<SocialClient isDemo={false} />);
    await screen.findByText('Synthetic insight');
    fireEvent.click(screen.getByText('◎ Run HLNA Analysis'));
    await screen.findByText('HLNA generated 4 insights.');
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(5));
    expect(fetchMock.mock.calls).toEqual([...GETS, ['/api/social/analyse', { method: 'POST' }], ...GETS]);
  });

  it('Export Report opens a blank window and writes the generated report (no fetch)', async () => {
    fetchMock.mockImplementation(socialResponder());
    const doc = { write: vi.fn(), close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({ document: doc }) as unknown as Window);
    renderUi(<SocialClient isDemo={false} />);
    await screen.findByText('Synthetic insight');
    fireEvent.click(screen.getByText('↗ Export Report'));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(doc.write).toHaveBeenCalledTimes(1);
    const html = doc.write.mock.calls[0][0] as string;
    expect(html).toContain('Synthetic insight');
    expect(html).toContain('Recommended: Do a thing');
    expect(html).toContain('Recommended: —');
    expect(html).toContain(['Synthetic insight', 'Synthetic insight summary', 'Recommended: Do a thing', '', '---', '', 'Second insight', 'Second summary', 'Recommended: —'].join('\n'));
    expect(doc.close).toHaveBeenCalled();
    expect(fetchMock.mock.calls).toEqual(GETS);
  });

  it('demo empty state: "Load Demo Data" runs the base sync POST (demo connect = sync)', async () => {
    let posts: unknown[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/social/posts?limit=25') return new Response(JSON.stringify({ posts }), { status: 200 });
      if (url === '/api/social/sync') { posts = POSTS; return new Response(JSON.stringify({ synced: 1, comments: 3 }), { status: 200 }); }
      return new Response(JSON.stringify({ insights: [] }), { status: 200 });
    });
    renderUi(<SocialClient isDemo />);
    await screen.findByText('Social Intelligence — Demo Mode');
    expect(screen.getByText('META_APP_ID is not configured. Load demo data to explore the Social Intelligence dashboard with realistic sample content.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Load Demo Data')[1]);
    await screen.findByText('Synced 1 posts and 3 comments.');
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(5));
    expect(fetchMock.mock.calls).toEqual([...GETS, ['/api/social/sync', { method: 'POST' }], ...GETS]);
  });

  it('non-demo empty state: Connect Instagram does not call sync (it navigates to /api/social/connect)', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ posts: [], insights: [] }), { status: 200 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderUi(<SocialClient isDemo={false} />);
    await screen.findByRole('heading', { name: 'Connect Instagram' });
    expect(screen.getByText('+ Connect Instagram')).toBeInTheDocument();
    expect(screen.getByText('Load Demo Data Instead')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ Connect Instagram'));
    await new Promise(r => setTimeout(r, 0));
    expect(fetchMock.mock.calls).toEqual(GETS);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Integrations
// ════════════════════════════════════════════════════════════════════════════

const INTEGRATIONS = [
  { id: 'i1', organisation_id: 'org-test', connector_id: 'rest', name: 'Test REST', config: { url: 'https://example.test/a' }, target_table: 'waste_records', schedule: '0 2 * * *', enabled: true, last_synced_at: null, last_sync_status: null, last_sync_count: null, created_at: '2025-01-01' },
  { id: 'i2', organisation_id: 'org-test', connector_id: 'csv-url', name: 'Test CSV', config: { url: 'https://example.test/b.csv' }, target_table: 'fleet_metrics', schedule: '0 2 * * *', enabled: false, last_synced_at: null, last_sync_status: 'error', last_sync_count: 12, created_at: '2025-01-01' },
] as never[];
const CONNECTORS = [
  { id: 'csv-url', label: 'CSV URL', description: 'csv' },
  { id: 'rest', label: 'REST API', description: 'rest' },
];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('G2 contract — Integrations', () => {
  it('fires no request on mount, nor when opening/closing the add form', () => {
    renderUi(<IntegrationsClient integrations={INTEGRATIONS} connectors={CONNECTORS} />);
    fireEvent.click(screen.getByText('+ Add Integration'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Connect external data sources. Dashboards sync automatically every night at 2 AM.')).toBeInTheDocument();
  });

  it('row fields: name, connector id, target label, url, last-sync text with status + count', () => {
    renderUi(<IntegrationsClient integrations={INTEGRATIONS} connectors={CONNECTORS} />);
    for (const t of ['Test REST', 'rest', 'Waste', 'https://example.test/a', 'Test CSV', 'csv-url', 'Fleet', 'https://example.test/b.csv']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Last sync: —')).toHaveLength(2);
    expect(document.body.textContent).toContain('error (12 records)');
  });

  it('toggle: PATCH /api/integrations/:id with {enabled: !enabled} exactly as base', async () => {
    renderUi(<IntegrationsClient integrations={INTEGRATIONS} connectors={CONNECTORS} />);
    fireEvent.click(screen.getByTitle('Enable')); // i2 (disabled) → enable
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/i2', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ enabled: true }) });
    await waitFor(() => expect(screen.getAllByTitle('Disable')).toHaveLength(2));
    fireEvent.click(screen.getAllByTitle('Disable')[0]); // i1 → disable
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/integrations/i1', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ enabled: false }) });
  });

  it('sync: POST /api/integrations/:id/sync (method only); success → router.refresh + "success (n records)"; disabled rows cannot sync', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ recordsSynced: 5 }), { status: 200 }));
    renderUi(<IntegrationsClient integrations={INTEGRATIONS} connectors={CONNECTORS} />);
    const [sync1, sync2] = screen.getAllByText('Sync now').map(el => el.closest('button')!);
    expect(sync2).toBeDisabled();
    fireEvent.click(sync1);
    await waitFor(() => expect(document.body.textContent).toContain('success (5 records)'));
    expect(fetchMock.mock.calls).toEqual([['/api/integrations/i1/sync', { method: 'POST' }]]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sync failure marks the row "error" without refresh', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'bad' }), { status: 500 }));
    renderUi(<IntegrationsClient integrations={[INTEGRATIONS[0]]} connectors={CONNECTORS} />);
    fireEvent.click(screen.getByText('Sync now'));
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('delete: base confirm text; cancel = no request; confirm = DELETE /api/integrations/:id and row removed', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    renderUi(<IntegrationsClient integrations={INTEGRATIONS} connectors={CONNECTORS} />);
    fireEvent.click(screen.getAllByText('Delete')[1]);
    expect(confirm).toHaveBeenCalledWith('Delete this integration? Synced data will not be removed.');
    expect(fetchMock).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getAllByText('Delete')[1]);
    await waitFor(() => expect(screen.queryByText('Test CSV')).toBeNull());
    expect(fetchMock.mock.calls).toEqual([['/api/integrations/i2', { method: 'DELETE' }]]);
  });

  it('create (csv-url default connector): exact POST body incl. trimmed FY/month and chosen target; success prepends + closes', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ integration: {
      id: 'i3', organisation_id: 'org-test', connector_id: 'csv-url', name: 'New CSV', config: { url: 'https://example.test/n.csv' }, target_table: 'fleet_metrics',
      schedule: '0 2 * * *', enabled: true, last_synced_at: null, last_sync_status: null, last_sync_count: null, created_at: '2025-01-02',
    } }), { status: 201 }));
    renderUi(<IntegrationsClient integrations={INTEGRATIONS} connectors={CONNECTORS} />);
    fireEvent.click(screen.getByText('+ Add Integration'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Civica Waste API'), { target: { value: 'New CSV' } });
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/waste-data'), { target: { value: 'https://example.test/n.csv' } });
    fireEvent.change(screen.getByLabelText('Target Table'), { target: { value: 'fleet_metrics' } });
    fireEvent.change(screen.getByPlaceholderText('2025-26'), { target: { value: ' 2025-26 ' } });
    fireEvent.change(screen.getByPlaceholderText('Jan'), { target: { value: ' Jan ' } });
    expect(screen.queryByLabelText('Method')).toBeNull(); // rest-only fields hidden for csv-url
    fireEvent.click(screen.getByText('Save Integration'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ connector_id: 'csv-url', name: 'New CSV', config: { url: 'https://example.test/n.csv', financial_year: '2025-26', month: 'Jan' }, target_table: 'fleet_metrics' }),
    });
    await waitFor(() => expect(screen.queryByText('Save Integration')).toBeNull());
    const names = screen.getAllByText(/^(New CSV|Test REST|Test CSV)$/).map(el => el.textContent);
    expect(names).toEqual(['New CSV', 'Test REST', 'Test CSV']);
  });

  it('create (rest): method + parsed headers (values keep inner colons); empty FY/month omitted; error shown', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Nope' }), { status: 400 }));
    renderUi(<IntegrationsClient integrations={[]} connectors={CONNECTORS} />);
    expect(screen.getByText('No integrations yet. Add one to start auto-syncing your dashboards.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ Add Integration'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Civica Waste API'), { target: { value: 'REST feed' } });
    fireEvent.change(screen.getByLabelText('Connector'), { target: { value: 'rest' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/waste-data'), { target: { value: 'https://example.test/r' } });
    fireEvent.change(screen.getByLabelText('Headers (optional, one per line: Key: Value)'), { target: { value: 'Authorization: Bearer a:b\n  X-Key :  v1 \n\nnocolon' } });
    fireEvent.click(screen.getByText('Save Integration'));
    await screen.findByText('Nope');
    expect(fetchMock.mock.calls).toEqual([['/api/integrations', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ connector_id: 'rest', name: 'REST feed', config: { url: 'https://example.test/r', method: 'POST', headers: { Authorization: 'Bearer a:b', 'X-Key': 'v1', nocolon: '' } }, target_table: 'waste_records' }),
    }]]);
    expect(screen.getByText('Save Integration')).toBeInTheDocument(); // form stays open on error
  });
});
