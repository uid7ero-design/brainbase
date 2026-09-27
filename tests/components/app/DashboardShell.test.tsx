import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Authenticated visual-completion pass — P1. The municipal DashboardShell
// (and the /dashboard/overview Command Overview) rendered for real in jsdom
// in BOTH themes with representative consumer props: one h1, a real
// tablist, labelled header/form controls, the KPI strip through the shared
// Metric, and no axe violations. Recharts' ResponsiveContainer measures 0px
// in jsdom, so charts mount without drawing — the shell/KPI/table chrome is
// what is asserted here; chart colours are guarded by the palette source
// tests (dashboardShellVisual / dashboardCommandD2).

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/roads',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { default: DashboardShell } = await import('@/components/dashboard/DashboardShell');
const { default: OverviewClient } = await import('@/app/dashboard/overview/OverviewClient');
const { default: KpiCard } = await import('@/components/dashboard/ui/KpiCard');

// A representative consumer's props (synthetic municipal module, no tenant).
const PROPS = {
  title: 'Roads & Drainage',
  subtitle: 'Asset condition, works programme and capital delivery',
  headerColor: '#1e293b',
  accentColor: '#3b82f6',
  breadcrumbLabel: 'Roads',
  kpis: [
    { label: 'Network Length', value: '412 km', sub: 'sealed + unsealed', icon: '🛣' },
    { label: 'Open Defects', value: 37, status: 'risk' as const, sub: '9 critical' },
    { label: 'Avg PCI', value: 61, status: 'watch' as const },
    { label: 'Capex Spent', value: '$654k' },
  ],
  insightCards: [
    { problem: 'Arterial PCI below intervention level', cause: 'Deferred reseals', recommendation: 'Bring forward two reseals', severity: 'High' as const },
    { problem: 'Drainage pits blocked after storms', cause: 'Leaf litter', recommendation: 'Add a pre-storm sweep', severity: 'Low' as const },
  ],
  recommendedActions: [
    { title: 'Reseal Industrial Drive', explanation: 'PCI 28', impact: '$120,000 avoided rework', priority: 'High' as const },
    { title: 'Rebalance reactive crews', explanation: 'Overtime', impact: '$40,000 saved', priority: 'Medium' as const },
  ],
  executiveSummary: 'Network condition is stable; two arterials need intervention this quarter.',
  overviewContent: <section aria-label="Module overview"><p>Module overview content</p></section>,
  industryTabs: [{ label: 'Works Programme', content: <p>Works programme content</p> }],
  monthlyTrend: [
    { month: 'Jul', actual: 100, budget: 110, prevYear: 90 },
    { month: 'Aug', actual: 120, budget: 110 },
  ],
  costAccounts: [
    { account: 'Reactive', budget: 1000, actual: 1200, dept: 'Roads' },
    { account: 'Planned', budget: 2000, actual: 1800 },
  ],
  slaTargets: [
    { kpi: 'Pothole response', target: '48h', actual: '52h', status: 'At Risk' as const },
    { kpi: 'Defect inspections', target: '100%', actual: '100%', status: 'Met' as const },
    { kpi: 'Reseal programme', target: '12 km', actual: '6 km', status: 'Missed' as const, note: 'Weather' },
  ],
  defaultActions: [
    { id: 'a1', title: 'Tender reseal package', assignee: 'Asset lead', dueDate: '2020-01-01', status: 'In progress' as const, priority: 'High' as const },
  ],
  aiContext: 'Roads module',
};

function renderShell(theme: 'light' | 'dark', extra: Record<string, unknown> = {}) {
  localStorage.clear();
  localStorage.setItem('bb-theme', theme);
  return renderBrainbase(<ThemeProvider><DashboardShell {...PROPS} {...extra} /></ThemeProvider>, { theme });
}

describe.each(['light', 'dark'] as const)('DashboardShell (%s)', theme => {
  it('overview: one h1, labelled header controls, tablist, KPI strip, no axe violations', async () => {
    const { container } = renderShell(theme);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Roads & Drainage' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Switch dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Financial year' })).toHaveValue('FY2025-26');
    expect(screen.getByRole('button', { name: /Ask HLNA to explain/ })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Roads & Drainage views' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual([
      'Overview', 'Works Programme', 'Data Upload', 'Financial Year', 'Cost Breakdown', 'Trends', 'Compliance', 'AI Report', 'Actions', 'Export',
    ]);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // KPI strip goes through the shared Metric: label → value, status written as tone.
    expect(screen.getByText('Open Defects').nextElementSibling).toHaveTextContent('37');
    expect(screen.getByText('Open Defects').nextElementSibling).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByText('Avg PCI').nextElementSibling).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('Module overview content')).toBeInTheDocument();
    expect(screen.getByText('$160,000 identified')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'AI Opportunities' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  }, 30_000);

  it('the shell surface carries no forced dark inline palette', () => {
    const { container } = renderShell(theme, { theme: 'dark' });
    const html = container.innerHTML;
    expect(html).not.toMatch(/rgba\(255,\s*255,\s*255/);
    expect(html).not.toMatch(/#0f0f0f|#1a1a2e|#0b0b0c|#131315/i);
    expect(html).not.toMatch(/linear-gradient/);
  });

  it('tabs: arrows move the selection; each global tab renders labelled content without axe violations', async () => {
    const { container, user } = renderShell(theme);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Works Programme' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Works Programme' })).toHaveFocus();
    expect(screen.getByText('Works programme content')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Compliance' }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Compliance' }).id);
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 targets met')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('tab', { name: 'Actions' }));
    await user.click(screen.getByRole('button', { name: '+ Add Action' }));
    for (const name of ['Action title', 'Assigned to', 'Due date', 'Priority']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Status for Tender reseal package' })).toHaveValue('In progress');
    await user.type(screen.getByLabelText('Action title'), 'Inspect culverts');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Inspect culverts')).toBeInTheDocument();
    await expectNoAxeViolations(container);

  }, 30_000);

  it.each(['Data Upload', 'Financial Year', 'Cost Breakdown', 'Trends', 'AI Report', 'Export'])('the %s tab renders without axe violations', async tab => {
    const { container, user } = renderShell(theme);
    await user.click(screen.getByRole('tab', { name: tab }));
    expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'shell-content');
    await expectNoAxeViolations(container);
  }, 30_000);
});

describe.each(['light', 'dark'] as const)('KpiCard (%s)', theme => {
  it('writes the status out and never forces a dark palette', async () => {
    const { container } = renderBrainbase(
      <main><h1>KPIs</h1><KpiCard label="Open" value={4} status="risk" accentColor="var(--status-info)" theme="dark" /></main>, { theme });
    expect(screen.getByText('(At risk)')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/rgba\(255,\s*255,\s*255|linear-gradient/);
    await expectNoAxeViolations(container);
  });
});

describe.each(['light', 'dark'] as const)('/dashboard/overview Command Overview (%s)', theme => {
  it('renders metrics, service requests, alerts and quick-nav with no axe violations', async () => {
    localStorage.setItem('bb-theme', theme);
    const { container, user } = renderBrainbase(
      <ThemeProvider>
        <OverviewClient
          waste={{ total_cost: 1_250_000, total_tonnes: 4200, avg_contamination: 11.2 }}
          fleet={{ total_fuel: 200_000, total_maintenance: 50_000, total_wages: 100_000, vehicle_count: 12, total_defects: 7 }}
          serviceRequests={[{ status: 'Open', count: 24, avg_days: 8.5 }, { status: 'Closed', count: 90, avg_days: 0 }]}
          trend={[{ month: 'Jul', waste: 100_000, fleet: 30_000 }]}
          alerts={[{ severity: 'HIGH', label: 'Northside contamination', detail: '13% — threshold 8%' }, { severity: 'MED', label: 'V-12 defects', detail: '2 defects recorded' }]}
          uploadSummary={[{ fileName: 'waste.xlsx', serviceType: 'waste', uploadedAt: '2026-01-01T00:00:00Z', recordCount: 120 }]}
        />
      </ThemeProvider>, { theme });
    expect(screen.getByRole('heading', { level: 1, name: 'Command Overview' })).toBeInTheDocument();
    expect(screen.getByText('1 HIGH ALERT')).toBeInTheDocument();
    expect(screen.getByText('Total Spend').nextElementSibling).toHaveTextContent('$1.6M');
    expect(screen.getByText('Contamination').nextElementSibling).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByText('Open SRs').nextElementSibling).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('Fleet Defects').nextElementSibling).toHaveAttribute('data-tone', 'warning');
    const waste = screen.getByRole('button', { name: /Waste/ });
    expect(waste).toHaveAttribute('aria-pressed', 'true');
    await user.click(waste);
    expect(waste).toHaveAttribute('aria-pressed', 'false');
    const nav = screen.getByRole('navigation', { name: 'Service Dashboards' });
    expect(within(nav).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/dashboard/waste', '/dashboard/fleet', '/dashboard/water', '/dashboard/roads', '/dashboard/parks', '/dashboard/labour', '/dashboard/integrations',
    ]);
    expect(container.innerHTML).not.toMatch(/rgba\(255,\s*255,\s*255|#C4B5FD|#A78BFA|linear-gradient/i);
    await expectNoAxeViolations(container);
  });
});

// Every static municipal module page that renders the shell, mounted for
// real in both themes (overview tab: KPI strip, insight cards, module charts
// chrome and opportunities). FleetClient / WasteClient take server props and
// are covered by the source guard.
const MODULE_PAGES = ['construction', 'depot', 'environment', 'facilities', 'labour', 'logistics', 'parks', 'roads', 'supply', 'water'] as const;

describe.each(['light', 'dark'] as const)('municipal module pages (%s)', theme => {
  it.each(MODULE_PAGES)('/dashboard/%s renders one h1 and has no axe violations', async name => {
    const { default: Page } = await import(`@/app/dashboard/${name}/page.tsx`);
    localStorage.clear();
    localStorage.setItem('bb-theme', theme);
    const { container } = renderBrainbase(<ThemeProvider><Page /></ThemeProvider>, { theme });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(container.innerHTML).not.toMatch(/rgba\(255,\s*255,\s*255|linear-gradient/);
    await expectNoAxeViolations(container);
  }, 30_000);
});
