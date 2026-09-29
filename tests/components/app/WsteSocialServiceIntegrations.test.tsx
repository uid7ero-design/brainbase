import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Remaining visual islands pass (worker B) — WSTe overview + property detail
// (+ ServiceTimeline), Service Requests, Social Intelligence and
// Integrations, rendered in BOTH themes with synthetic fixtures: one page
// h1, labelled tabs/filters/switches/fields, unchanged fetch contracts
// (mocked — nothing real is synced, created or deleted) and no axe
// violations. Colours are guarded by the source test
// tests/containment/wsteSocialServiceIntegrationsVisual.test.ts.

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push, refresh }),
}));

const fireHelena = vi.fn();
vi.mock('@/lib/state/useAppStore', () => {
  const useAppStore = () => ({ fireHelena, setOrbAlert: vi.fn() });
  useAppStore.getState = () => ({ fireHelena, setChatOpen: vi.fn() });
  return { useAppStore };
});

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { default: WSTEClient } = await import('@/app/dashboard/wste/WSTEClient');
const { default: PropertyClient } = await import('@/app/dashboard/wste/property/[id]/PropertyClient');
const { default: ServiceRequestsClient } = await import('@/app/dashboard/service-requests/ServiceRequestsClient');
const { default: SocialClient } = await import('@/app/dashboard/social/SocialClient');
const { default: IntegrationsClient } = await import('@/app/dashboard/integrations/IntegrationsClient');

function renderIn(theme: 'light' | 'dark', ui: React.ReactElement) {
  localStorage.clear();
  localStorage.setItem('bb-theme', theme);
  return renderBrainbase(<ThemeProvider>{ui}</ThemeProvider>, { theme });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  push.mockReset(); refresh.mockReset(); fireHelena.mockReset();
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

// ── Fixtures (synthetic) ────────────────────────────────────────────────────

const KPIS = { total_gps_points: 1200, vehicles_tracked: 2, runs_analysed: 3, tickets_matched: 40, exceptions_identified: 2, verification_rate: 96.5 };
const RUNS = [
  { id: 'r1', run_date: '2025-01-02', vehicle_registration: 'TEST001', driver: 'A. Driver', route_name: 'Route A', suburb: 'Alpha', gps_points: 1500, tickets_matched: 20, exceptions_count: 0, verified: true, completion_pct: 100 },
  { id: 'r2', run_date: '2025-01-03', vehicle_registration: 'TEST002', driver: 'B. Driver', route_name: 'Route B', suburb: 'Beta', gps_points: 900, tickets_matched: 20, exceptions_count: 6, verified: false, completion_pct: 85 },
];
const EXCEPTIONS = [
  { id: 'e1', run_date: '2025-01-03', vehicle_registration: 'TEST002', address: '1 Test St', suburb: 'Beta', exception_type: 'Missed Service', severity: 'high' as const, resolved: false },
  { id: 'e2', run_date: '2025-01-03', vehicle_registration: 'TEST002', address: '2 Test St', suburb: 'Beta', exception_type: 'GPS Gap', severity: 'low' as const, resolved: true },
];
const VEHICLES = [{ id: 'v1', registration: 'TEST001', make: 'Make', model: 'M1', vehicle_type: 'Rear Loader', depot: 'Depot A', active: true }];

const PROPERTY = {
  address: '1 Test St', suburb: 'Beta', zone: 'Zone 1', account_ref: 'ACC-0001', lat: 0, lng: 0,
  assets: [{ rfid: 'BIN-TEST-1', type: 'General Waste', volume: '140L', colour: 'Red lid', status: 'active' as const }],
  planned_services: [{ service_type: 'General Waste', schedule: 'Weekly', run: 'R1', window: '06:00–10:00', next_date: '2025-01-10' }],
  verification: {
    status: 'likely_missed' as const, scenario: 'route_bypass' as const, vehicle_reg: 'TEST002', driver: 'B. Driver',
    run_name: 'Route B', pass_time: null, distance_m: 90, speed_kmh: 30, confidence: 30, linked_exception: 'Missed Service', gps_points_nearby: 0,
  },
  service_events: [
    { id: 's1', date: '2025-01-03', service_type: 'bin_collection' as const, service_name: 'Weekly collection', verification_status: 'likely_missed' as const, confidence: 30, evidence: [{ type: 'gps' as const, description: 'No pass within 80m' }], details: [{ label: 'Run', value: 'Route B' }], notes: 'Synthetic note' },
    { id: 's2', date: '2024-12-27', service_type: 'hard_waste' as const, service_name: 'Hard waste pickup', verification_status: 'verified' as const, evidence: [], details: [] },
  ],
  intelligence_summary: 'Synthetic summary.', intelligence_action: 'Synthetic action', intelligence_level: 'alert' as const,
};
const ENGINE = {
  status: 'likely_missed' as const, confidence: 28, confidenceLabel: 'low' as const, passDetected: false, stopDetected: false,
  liftDetected: false, exceptionDetected: true, nearestGpsM: 95, passTimeIso: null, stopDurationSec: null, vehicleMatch: null,
  inServiceWindow: true, gpsGapSec: null, evidenceSummary: 'Synthetic engine summary.', matchedEvidence: [],
};

const SR_ROWS = [
  { request_id: 'SR-1', service_type: 'Missed Bin', suburb: 'Alpha', month: 'Jan', status: 'Open', priority: 'High', days_open: 9, cost: 100 },
  { request_id: 'SR-2', service_type: 'Graffiti', suburb: 'Beta', month: 'Feb', status: 'Closed', priority: 'Low', days_open: 2, cost: 50 },
  { request_id: 'SR-3', service_type: 'Pothole', suburb: 'Beta', month: 'Feb', status: 'Pending', priority: 'Medium', days_open: 4, cost: 70 },
];
const MONTHS = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];

const INTEGRATIONS = [
  { id: 'i1', organisation_id: 'org-test', connector_id: 'rest' as const, name: 'Test REST', config: { url: 'https://example.test/a' }, target_table: 'waste_records' as const, schedule: '0 2 * * *', enabled: true, last_synced_at: null, last_sync_status: null, last_sync_count: null, created_at: '2025-01-01' },
  { id: 'i2', organisation_id: 'org-test', connector_id: 'csv-url' as const, name: 'Test CSV', config: { url: 'https://example.test/b.csv' }, target_table: 'fleet_metrics' as const, schedule: '0 2 * * *', enabled: false, last_synced_at: null, last_sync_status: 'error' as const, last_sync_count: null, created_at: '2025-01-01' },
] as never[];
const CONNECTORS = [
  { id: 'csv-url', label: 'CSV URL', description: 'csv' },
  { id: 'rest', label: 'REST API', description: 'rest' },
];

describe.each(['light', 'dark'] as const)('WSTe overview (%s)', theme => {
  it('one h1, metric strip, labelled tabs, property links unchanged, no axe violations', async () => {
    const { container } = renderIn(theme, <WSTEClient isDemo kpis={KPIS} runs={RUNS} exceptions={EXCEPTIONS} vehicles={VEHICLES} />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('WSTe — Waste Service Tracking & Exceptions');
    expect(screen.getByText('Verification Rate')).toBeInTheDocument();
    expect(screen.getByText('1 open exception — 1 high severity requiring review')).toBeInTheDocument();

    const tabs = within(screen.getByRole('tablist', { name: 'WSTe views' })).getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Recent Runs (2)', 'Exceptions (1)']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Recent runs' })).toBeInTheDocument();
    await expectNoAxeViolations(container);

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveFocus();
    expect(screen.getByRole('link', { name: '1 Test St' })).toHaveAttribute('href', '/dashboard/wste/property/1-test-st');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show resolved' }));
    expect(tabs[1]).toHaveTextContent('Exceptions (2)');
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('address lookup keeps its simulated verify flow and property link', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    renderIn(theme, <WSTEClient isDemo={false} kpis={KPIS} runs={RUNS} exceptions={[]} vehicles={VEHICLES} />);
    const input = screen.getByRole('textbox', { name: 'Property address' });
    const verify = screen.getByRole('button', { name: 'Verify' });
    expect(verify).toBeDisabled();
    fireEvent.change(input, { target: { value: '9 Sample Rd' } });
    fireEvent.click(verify);
    expect(screen.getByRole('button', { name: '...' })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText('Service Verified')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Property Intelligence →' })).toHaveAttribute('href', '/dashboard/wste/property/9-sample-rd');
  });
});

describe.each(['light', 'dark'] as const)('WSTe property detail + ServiceTimeline (%s)', theme => {
  it('h1 = address, breadcrumb back link, timeline filters and expanders, no axe violations', async () => {
    const { container } = renderIn(theme, <PropertyClient data={PROPERTY} propertyId="1-test-st" engineResult={ENGINE} />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('1 Test St');
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: '← WSTe' })).toHaveAttribute('href', '/dashboard/wste');
    expect(screen.getByText('Intelligence Summary · Service Issue Identified')).toBeInTheDocument();
    expect(screen.getAllByText('Route bypassed').length).toBeGreaterThan(0);
    expect(screen.getByText('ENGINE')).toBeInTheDocument();

    expect(screen.getByRole('heading', { level: 2, name: 'Service & Evidence Timeline (2)' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Filter by service type' });
    const binFilter = within(group).getByRole('button', { name: 'Bin Collection' });
    expect(binFilter).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(binFilter);
    expect(binFilter).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Service & Evidence Timeline (1)' })).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Weekly collection/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Synthetic note')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    fireEvent.click(within(group).getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Service & Evidence Timeline (2)' })).toBeInTheDocument();
  });
});

describe.each(['light', 'dark'] as const)('Service Requests (%s)', theme => {
  it('one h1, Helena prompt unchanged, filters are pressed toggles, tabs are keyboard tabs, no axe violations', async () => {
    const { container } = renderIn(theme, <ServiceRequestsClient isDemo uploadMeta={null} rows={SR_ROWS} monthOrder={MONTHS} />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Service Requests');
    expect(screen.getByText('1 HIGH PRIORITY')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ask HLNΛ' }));
    expect(fireHelena).toHaveBeenCalledWith('Analyse the current service requests — which suburbs and request types are generating the most open items? Are there any resolution time concerns?');

    const status = screen.getByRole('group', { name: 'Filter by status' });
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    fireEvent.click(within(status).getByRole('button', { name: 'Closed' }));
    expect(within(status).getByRole('button', { name: 'Closed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    const tabs = within(screen.getByRole('tablist', { name: 'Service request views' })).getAllByRole('tab');
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Type Breakdown' })).toBeInTheDocument();
    fireEvent.click(tabs[2]);
    expect(screen.getByRole('region', { name: 'Suburb summary' })).toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(screen.getByRole('heading', { level: 2, name: 'Request Volume by Month' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe.each(['light', 'dark'] as const)('Social Intelligence (%s)', theme => {
  function mockSocial() {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/social/posts?limit=25') return new Response(JSON.stringify({ posts: [
        { id: 'p1', caption: 'Synthetic post', engagement_score: 400, like_count: 10, comments_count: 1, comments: [{ text: 'Synthetic complaint', sentiment: 'negative', username: 'tester' }] },
      ] }), { status: 200 });
      if (url === '/api/social/insights') return new Response(JSON.stringify({
        insights: [{ id: 'n1', title: 'Synthetic insight', summary: 'Synthetic insight summary', confidence: 'high', recommended_action: 'Do a thing' }],
        stats: { post_count: 1, avg_engagement: 400 }, commentStats: { total_comments: 1, positive_count: 0, urgent_count: 1 },
      }), { status: 200 });
      if (url === '/api/social/sync') return new Response(JSON.stringify({ synced: 3, comments: 2 }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
  }

  it('loads via the unchanged endpoints, one h1, tabs, sync notice, no axe violations', async () => {
    mockSocial();
    const { container } = renderIn(theme, <SocialClient isDemo={false} />);
    await screen.findByText('Synthetic insight');
    expect(fetchMock).toHaveBeenCalledWith('/api/social/posts?limit=25');
    expect(fetchMock).toHaveBeenCalledWith('/api/social/insights');
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Social Intelligence');
    expect(screen.getByRole('button', { name: /Synthetic insight/ })).toHaveAttribute('aria-expanded', 'true');
    await expectNoAxeViolations(container);

    fireEvent.click(screen.getByRole('button', { name: '↻ Sync Now' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Synced 3 posts and 2 comments.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/social/sync', { method: 'POST' });

    const tabs = within(screen.getByRole('tablist', { name: 'Social views' })).getAllByRole('tab');
    fireEvent.click(tabs[2]);
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Synthetic complaint')).toBeInTheDocument();
    fireEvent.click(tabs[1]);
    expect(screen.getByText('Synthetic post')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('empty state keeps the demo connect action (no real sync: fetch is mocked)', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ posts: [], insights: [] }), { status: 200 }));
    const { container } = renderIn(theme, <SocialClient isDemo />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Social Intelligence — Demo Mode' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Load Demo Data' })).toHaveLength(2);
    await expectNoAxeViolations(container);
  });
});

describe.each(['light', 'dark'] as const)('Integrations (%s)', theme => {
  it('one h1, labelled switch + fields, unchanged fetch contracts (mocked), no axe violations', async () => {
    const { container } = renderIn(theme, <IntegrationsClient integrations={INTEGRATIONS} connectors={CONNECTORS} />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Integrations');
    const sw = screen.getByRole('switch', { name: 'Enabled: Test REST' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Enabled: Test CSV' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByRole('button', { name: 'Sync now' })[1]).toBeDisabled();
    await expectNoAxeViolations(container);

    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/i1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    });

    vi.stubGlobal('confirm', vi.fn(() => false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/integrations/i1', { method: 'DELETE' });

    const add = screen.getByRole('button', { name: '+ Add Integration' });
    expect(add).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(add);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-expanded', 'true');
    const form = screen.getByRole('form', { name: 'New Integration' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'New feed' } });
    fireEvent.change(within(form).getByLabelText('Connector'), { target: { value: 'rest' } });
    expect(within(form).getByLabelText('Method')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('URL'), { target: { value: 'https://example.test/new' } });
    fireEvent.change(within(form).getByLabelText('Headers (optional, one per line: Key: Value)'), { target: { value: 'X-Key: abc' } });
    await expectNoAxeViolations(container);

    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Nope' }), { status: 400 }));
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nope'));
    const call = fetchMock.mock.calls.find(c => c[0] === '/api/integrations');
    expect(call?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse((call?.[1] as { body: string }).body)).toEqual({
      connector_id: 'rest', name: 'New feed', config: { url: 'https://example.test/new', method: 'GET', headers: { 'X-Key': 'abc' } }, target_table: 'waste_records',
    });
  });

  it('empty list renders a state message', async () => {
    const { container } = renderIn(theme, <IntegrationsClient integrations={[]} connectors={CONNECTORS} />);
    expect(screen.getByText('No integrations yet. Add one to start auto-syncing your dashboards.')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
