import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Authenticated visual-completion pass — decision 7: one page-level h1 per
// Waste route. The module title in app/dashboard/waste/layout.tsx is the h1
// on sub-pages; on the Overview the real DashboardShell renders the page h1
// and the module title drops to a non-heading label (same copy).

let pathname = '/dashboard/waste';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { default: WasteLayout } = await import('@/app/dashboard/waste/layout');
const { default: DashboardShell } = await import('@/components/dashboard/DashboardShell');

const SHELL = (
  <DashboardShell
    title="Waste & Recycling"
    subtitle="Synthetic module"
    headerColor="#0f172a"
    accentColor="#10b981"
    breadcrumbLabel="Waste"
    kpis={[{ label: 'Tonnes collected', value: '1,204' }]}
    insightCards={[]}
    recommendedActions={[]}
    executiveSummary="Stable."
    overviewContent={<p>Overview content</p>}
    industryTabs={[]}
    monthlyTrend={[]}
    costAccounts={[]}
    slaTargets={[]}
  />
);

const SUBPAGE = <main><h2>Bin lifts by zone</h2><p>Sub-page content</p></main>;

beforeEach(() => { pathname = '/dashboard/waste'; });

describe.each(['light', 'dark'] as const)('Waste module headings (%s)', theme => {
  it('Overview: exactly one h1 (the shell page title); the module title is a label', async () => {
    pathname = '/dashboard/waste';
    const { container } = renderBrainbase(<ThemeProvider><WasteLayout>{SHELL}</WasteLayout></ThemeProvider>, { theme });
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Waste & Recycling');
    const label = screen.getByText('Waste & Recycling Intelligence');
    expect(label.tagName).toBe('P');
    await expectNoAxeViolations(container);
  });

  it.each(['/dashboard/waste/bin-lifts', '/dashboard/waste/budgeting', '/dashboard/waste/compliance'])(
    'sub-page %s: the module title is the one h1', async path => {
      pathname = path;
      const { container } = renderBrainbase(<WasteLayout>{SUBPAGE}</WasteLayout>, { theme });
      const h1s = screen.getAllByRole('heading', { level: 1 });
      expect(h1s).toHaveLength(1);
      expect(h1s[0]).toHaveTextContent('Waste & Recycling Intelligence');
      await expectNoAxeViolations(container);
    });
});
