import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { Metric, MetricStrip } from '@/components/ui/app';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { CHART_PALETTE, useChartPalette } from '@/components/ui/app/chartPalette';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase D2 — Dashboard, Command Centre and shared intelligence surfaces,
// rendered for real (jsdom) with fixture data. Behaviour is asserted where
// D2 changed the markup (tabs, ribbon, edit cells, chat labelling).

vi.mock('next/navigation', () => ({
  usePathname: () => '/command',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { default: OrganisationDashboard } = await import('@/components/dashboard/OrganisationDashboard');
const { ModuleAccessCard } = await import('@/components/dashboard/ModuleAccessCard');
const { default: HlnaBriefingWidget } = await import('@/components/ops/widgets/HlnaBriefingWidget');
const { default: WeatherWidget } = await import('@/components/ops/widgets/WeatherWidget');
const { default: MapWidget } = await import('@/components/ops/widgets/MapWidget');
const { default: IntelRail } = await import('@/components/ops/IntelRail');
const { default: FinancialTab } = await import('@/app/command/financial');
const { default: CommandPage } = await import('@/app/command/page');

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

const FINANCIAL = {
  financial_year: '2025-26',
  forecast_params: { multiplier: 1, as_at_date: '2026-06-30' },
  line_items: [
    { gl: '4100', description: 'Waste disposal', category: 'EXPENSE', budget_fy: 1000, ytd_actual: 800, commitments: 50, eofy_forecast: 1100, variance: -100, variance_pct: -10, has_override: true },
  ],
  rise_and_fall: [],
  summary: {
    expenses: { budget_fy: 1000, ytd_actual: 800, commitments: 50, eofy_forecast: 1100, variance: -100 },
    recoveries: { budget_fy: 0, ytd_actual: 0, commitments: 0, eofy_forecast: 0, variance: 0 },
    revenue: { budget_fy: 0, ytd_actual: 0, commitments: 0, eofy_forecast: 0, variance: 0 },
    net: { budget_fy: 1000, eofy_forecast: 1100 },
  },
};

beforeEach(() => {
  // The Command page restores ?tab= from the URL on mount; start each test on Overview.
  window.history.replaceState(null, '', '/command');
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/financial/')) return json({ data: FINANCIAL });
    if (url.includes('/api/missed-collections/kpi')) return json({ data: { missedCount: 42, completionRate: 90 } });
    if (url.includes('/api/illegal-dumping/kpi')) return json({ data: { totalIncidents: 3 } });
    if (url.includes('/api/waste/kpi')) return json({ data: { diversionRate: 58 } });
    if (url.includes('/api/admin/pipeline')) return json({ requests: [] });
    if (url.includes('/api/me')) return json({ name: 'Alex Morgan', role: 'admin' });
    return json({});
  }));
});

// ── Metric (extended) ──────────────────────────────────────────────────
describe('Metric — change line and decorative visual', () => {
  function Strip({ loading = false }: { loading?: boolean }) {
    return (
      <main>
        <h1>KPIs</h1>
        <MetricStrip>
          <Metric
            label="Missed Bins"
            value={42}
            loading={loading}
            change={{ label: '4% of sched.', direction: 'up', tone: 'danger' }}
            visual={<svg data-testid="spark" />}
          />
        </MetricStrip>
      </main>
    );
  }

  it('writes the change as text, draws direction as a hidden glyph, and tones it independently of direction', () => {
    const { container } = renderBrainbase(<Strip />);
    const change = container.querySelector('dd[data-tone="danger"]')!;
    expect(container.querySelector('dd > span[data-tone]')).toBeNull(); // value carries no tone here
    expect(change).toHaveTextContent('▲ 4% of sched.');
    expect(within(change as HTMLElement).getByText('▲', { exact: false })).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('spark').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('while loading: placeholder only, no change line or visual', () => {
    renderBrainbase(<Strip loading />);
    expect(screen.queryByText('4% of sched.')).toBeNull();
    expect(screen.queryByTestId('spark')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<Strip />, { theme });
    await expectNoAxeViolations(container);
  });
});

// ── Organisation dashboard ─────────────────────────────────────────────
describe('OrganisationDashboard', () => {
  const busy = {
    waste: { total_cost: 1_250_000, total_tonnes: 5400, avg_contamination: 12.4 },
    fleet: { total_fuel: 200_000, total_maintenance: 50_000, total_wages: 0, vehicle_count: 18, total_defects: 3 },
    serviceRequests: [{ status: 'Open', count: 25, avg_days: 4.2 }, { status: 'Closed', count: 90, avg_days: 0 }],
  };

  it('page header with org context and the HLNA link; exceptions written as text before the metrics', () => {
    renderBrainbase(<OrganisationDashboard orgName="City of Example" enabledCapabilities={['events']} {...busy} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('City of Example')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open HLNA' })).toHaveAttribute('href', '/hlna');
    const exceptions = screen.getByRole('list', { name: 'Needs attention' });
    const items = within(exceptions).getAllByRole('listitem').map(li => li.textContent);
    expect(items).toEqual([
      'Above thresholdContamination averaging 12.4% (threshold 10%)',
      'Backlog25 open service requests (threshold 20)',
    ]);
    // Defects (3) are within threshold: no exception, no tone.
    expect(screen.getByText('Fleet Defects').nextElementSibling).not.toHaveAttribute('data-tone');
    expect(screen.getByText('Contamination').nextElementSibling).toHaveAttribute('data-tone', 'danger');
  });

  it('module access comes after the metrics, as a compact list of links', () => {
    const { container } = renderBrainbase(<OrganisationDashboard enabledCapabilities={['events', 'crm']} {...busy} />);
    const metrics = container.querySelector('dl')!;
    const tools = screen.getByRole('heading', { name: 'Your Tools' });
    expect(metrics.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: /Events & Ticketing/ })).toHaveAttribute('href', '/events');
    expect(screen.getByRole('link', { name: /CRM/ })).toHaveAttribute('href', '/crm');
  });

  it('empty state when there is no operational data (no fake numbers)', () => {
    renderBrainbase(<OrganisationDashboard enabledCapabilities={[]} waste={{}} fleet={{}} serviceRequests={[]} />);
    expect(screen.getByText('No operational metrics available yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Needs attention' })).toBeNull();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<OrganisationDashboard orgName="City of Example" enabledCapabilities={['events', 'crm', 'organiser']} {...busy} />, { theme });
    await expectNoAxeViolations(container);
  });
});

describe('ModuleAccessCard', () => {
  it('renders nothing without an enabled capability', () => {
    const { container } = renderBrainbase(<ModuleAccessCard enabledCapabilities={[]} />);
    expect(container.querySelector('section')).toBeNull();
  });
});

// ── Widgets and rail ───────────────────────────────────────────────────
describe('Command widgets', () => {
  it('HLNA briefing: expand control reports its state; full summary is available to assistive tech at once', async () => {
    const { user } = renderBrainbase(<HlnaBriefingWidget />);
    const toggle = screen.getByRole('button', { name: '↓ Full Briefing' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: '↑ Collapse' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Missed bins are up 12% today/, { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Confidence' })).toHaveAttribute('aria-valuenow', '87');
  });

  it('map: the SVG is a described image and uses the theme chart palette', () => {
    localStorage.setItem('bb-theme', 'light');
    const { container } = renderBrainbase(<ThemeProvider><MapWidget /></ThemeProvider>, { theme: 'light' });
    const img = screen.getByRole('img', { name: /Operational Map/ });
    expect(img.querySelector('desc')).toHaveTextContent('North: Critical, 2 incidents.');
    const critical = container.querySelector('circle[cx="95"]')!;
    expect(critical.getAttribute('fill')).toBe(CHART_PALETTE.light.danger);
  });

  it('IntelRail: task priority is announced, not colour-only', () => {
    renderBrainbase(<ThemeProvider><IntelRail /></ThemeProvider>);
    expect(screen.getByRole('link', { name: /^critical priority: ?Resolve Route 4\+7 delays/ })).toHaveAttribute('href', '/dashboard/waste');
  });

  it.each(['light', 'dark'] as const)('briefing, weather, map and rail have no axe violations (%s)', async theme => {
    localStorage.setItem('bb-theme', theme);
    const { container } = renderBrainbase(
      <ThemeProvider>
        <main>
          <h1>Command</h1>
          <HlnaBriefingWidget />
          <WeatherWidget />
          <MapWidget />
          <IntelRail />
        </main>
      </ThemeProvider>,
      { theme },
    );
    await expectNoAxeViolations(container);
  });
});

describe('useChartPalette', () => {
  function Probe() {
    const p = useChartPalette();
    return <span data-testid="p">{p.primary}</span>;
  }
  it('follows the app theme', async () => {
    localStorage.setItem('bb-theme', 'light');
    renderBrainbase(<ThemeProvider><Probe /></ThemeProvider>);
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent(CHART_PALETTE.light.primary));
  });
});

// ── Financial tab ──────────────────────────────────────────────────────
describe('FinancialTab', () => {
  it('edit cells are keyboard-operable buttons that open a labelled input', async () => {
    const { user } = renderBrainbase(<main><FinancialTab /></main>);
    await screen.findByRole('tab', { name: 'Summary' });
    await user.click(screen.getByRole('tab', { name: 'Gross Expenses' }));
    const cell = screen.getByRole('button', { name: 'Budget FY, 4100 Waste disposal: $1,000. Edit' });
    cell.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Budget FY, 4100 Waste disposal' })).toBeInTheDocument();
    expect(screen.getByText('(manual override)', { exact: false })).toBeInTheDocument();
  });

  it('sub-tabs move with the arrow keys', async () => {
    const { user } = renderBrainbase(<main><FinancialTab /></main>);
    const summary = await screen.findByRole('tab', { name: 'Summary' });
    expect(summary).toHaveAttribute('aria-selected', 'true');
    summary.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Gross Expenses' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Gross Expenses' })).toHaveFocus();
  });

  it.each(['light', 'dark'] as const)('summary has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<main><h1>Financial</h1><FinancialTab /></main>, { theme });
    await screen.findByRole('tab', { name: 'Summary' });
    await expectNoAxeViolations(container);
  });
});

// ── Command page ───────────────────────────────────────────────────────
describe('Command page', () => {
  async function renderPage(theme: 'light' | 'dark' = 'dark') {
    localStorage.setItem('bb-theme', theme);
    const utils = renderBrainbase(<ThemeProvider><CommandPage /></ThemeProvider>, { theme });
    await screen.findByRole('tablist', { name: 'Command Centre views' });
    return utils;
  }

  it('tabs: one selected tab in the tab order, arrows move selection', async () => {
    const { user } = await renderPage();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Financial' })).toHaveAttribute('tabindex', '-1');
    overview.focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Sporting Clubs' })).toHaveAttribute('aria-selected', 'true');
  });

  it('status ribbon cells are buttons that expand in place', async () => {
    const { user } = await renderPage();
    const waste = screen.getByRole('button', { name: /^Waste\s*Attention/ });
    expect(waste).toHaveAttribute('aria-expanded', 'false');
    await user.click(waste);
    expect(waste).toHaveAttribute('aria-expanded', 'true');
    expect(within(waste).getByText(/Missed bins \+12%/)).toBeInTheDocument();
  });

  it('KPI strip renders live values through Metric with written trend; demo markers remain', async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('Missed Bins').nextElementSibling).toHaveTextContent('42'));
    expect(screen.getByText('Demo Environment')).toBeInTheDocument();
    expect(screen.getByText('DEMO')).toBeInTheDocument();
    expect(screen.getByText(/^Demo · /)).toBeInTheDocument();
  });

  it('assistant: labelled input, named send button, conversation log', async () => {
    await renderPage();
    expect(screen.getByRole('textbox', { name: 'Message HLNA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByRole('log', { name: 'Conversation with HLNA' })).toHaveTextContent('Monitoring all systems');
  });

  it('operational alert cards: status written as a badge, details open from a real button', async () => {
    await renderPage();
    const title = screen.getByText('Route delays exceeding KPI');
    const card = title.closest('article')!;
    expect(within(card).getByText('Critical')).toBeInTheDocument();
    expect(title.closest('button')).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it.each(['light', 'dark'] as const)('overview has no axe violations (%s)', async theme => {
    const { container } = await renderPage(theme);
    await act(async () => { await Promise.resolve(); });
    await expectNoAxeViolations(container);
  });
});
