import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Authenticated visual-completion pass — Waste & Recycling module. The layout
// frame + NavTabs and representative sub-pages (which use the shared _dark
// token module and useWasteChart) rendered in BOTH themes: module h1 and
// tab navigation semantics (aria-current on the active tab only), labelled
// tables, no axe violations. Recharts' ResponsiveContainer measures 0px in
// jsdom, so charts mount without drawing; chart colours are guarded by the
// source test tests/containment/wasteModuleVisual.test.ts.

let mockPath = '/dashboard/waste/bin-lifts';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { default: WasteLayout } = await import('@/app/dashboard/waste/layout');
const { default: BinLiftsPage } = await import('@/app/dashboard/waste/bin-lifts/page');
const { default: CompliancePage } = await import('@/app/dashboard/waste/compliance/page');
const { default: BudgetingPage } = await import('@/app/dashboard/waste/budgeting/page');
const { useWasteChart } = await import('@/app/dashboard/waste/_dark');
const { CHART_PALETTE } = await import('@/components/ui/app/chartPalette');

function SeriesProbe() {
  const chart = useWasteChart();
  return (
    <span
      data-testid="series-probe"
      data-emerald={chart.series('#10b981')}
      data-amber={chart.series('#f59e0b')}
      data-unknown={chart.series('var(--border-strong)')}
    />
  );
}

function renderIn(theme: 'light' | 'dark', ui: React.ReactElement) {
  localStorage.clear();
  localStorage.setItem('bb-theme', theme);
  return renderBrainbase(<ThemeProvider>{ui}</ThemeProvider>, { theme });
}

describe.each(['light', 'dark'] as const)('Waste module (%s)', theme => {
  it('layout + NavTabs: one module h1, labelled nav, aria-current on the active tab only', async () => {
    mockPath = '/dashboard/waste/bin-lifts';
    const { container } = renderIn(theme, <WasteLayout><BinLiftsPage /></WasteLayout>);

    expect(screen.getByText('Executive Operations Report')).toBeInTheDocument();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Waste & Recycling Intelligence');

    const nav = screen.getByRole('navigation', { name: 'Waste & Recycling sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(l => l.textContent)).toEqual([
      'Overview', 'Bin Lifts', 'Cost / HH', 'Budgeting', 'Diversion', 'Fleet',
      'Complaints', 'Commodities', 'Community', 'Green Waste', 'Compliance',
    ]);
    const current = links.filter(l => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Bin Lifts');
    expect(current[0]).toHaveAttribute('href', '/dashboard/waste/bin-lifts');

    // Sub-page sections are h2s under the module h1.
    expect(screen.getByRole('heading', { level: 2, name: 'Zone Lift Summary' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
    await expectNoAxeViolations(container);
  });

  it('Overview tab is current on /dashboard/waste (exact match, not prefix)', () => {
    mockPath = '/dashboard/waste';
    renderIn(theme, <WasteLayout><p>overview</p></WasteLayout>);
    const current = screen.getAllByRole('link').filter(l => l.getAttribute('aria-current') === 'page');
    expect(current.map(l => l.textContent)).toEqual(['Overview']);
    // On the Overview the page h1 comes from DashboardShell (the child), so the
    // layout contributes none; its module title is a same-copy label.
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getByText('Waste & Recycling Intelligence').tagName).toBe('P');
  });

  it('chart series resolve to the theme-aware accessible shade', () => {
    mockPath = '/dashboard/waste/bin-lifts';
    renderIn(theme, <WasteLayout><SeriesProbe /></WasteLayout>);
    const probe = screen.getByTestId('series-probe');
    expect(probe.dataset.emerald).toBe(theme === 'light' ? '#047857' : '#10b981');
    expect(probe.dataset.amber).toBe(CHART_PALETTE[theme].warning);
    expect(probe.dataset.unknown).toBe('var(--border-strong)');
  });

  it('Compliance page renders status badges with text and no axe violations', async () => {
    mockPath = '/dashboard/waste/compliance';
    const { container } = renderIn(theme, <WasteLayout><CompliancePage /></WasteLayout>);
    expect(screen.getAllByText(/Compliant|Due Soon|Overdue/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Compliance' }))
      .toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(container);
  });

  it('Budgeting page (charts + tables) has no axe violations', async () => {
    mockPath = '/dashboard/waste/budgeting';
    const { container } = renderIn(theme, <WasteLayout><BudgetingPage /></WasteLayout>);
    expect(screen.getByRole('heading', { level: 2, name: 'Category Budget Summary' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
