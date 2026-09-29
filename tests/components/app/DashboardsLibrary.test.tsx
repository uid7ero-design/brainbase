import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Remaining visual islands pass — /dashboards (module library) rendered in
// jsdom in both themes. Pins the preserved behaviour (category filter, every
// module link, footer links) and the accessibility contract added in the
// convergence (one page h1, pressed-state filter group, decorative glyphs
// hidden). Static page: no fetch, no tenant data.

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboards',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: DashboardsPage } = await import('@/app/dashboards/page');

const ALL_HREFS = [
  '/dashboard/waste', '/dashboard/fleet', '/dashboard/logistics', '/dashboard/construction',
  '/dashboard/roads', '/dashboard/water', '/dashboard/parks', '/dashboard/facilities',
  '/dashboard/depot', '/dashboard/supply', '/dashboard/labour', '/dashboard/environment',
  '/dashboard/wste',
];

describe.each(['light', 'dark'] as const)('/dashboards library (%s)', theme => {
  it('has exactly one page h1 and no axe violations', async () => {
    const { container } = renderBrainbase(<DashboardsPage />, { theme });
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Dashboards');
    expect(screen.getByRole('heading', { level: 2, name: 'Your operational intelligence library.' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('lists every module link unchanged, with category/title/metrics copy', () => {
    renderBrainbase(<DashboardsPage />, { theme });
    const grid = screen.getByRole('region', { name: 'Dashboards' });
    const links = within(grid).getAllByRole('link');
    expect(links.map(a => a.getAttribute('href'))).toEqual(ALL_HREFS);
    expect(within(grid).getByRole('heading', { level: 3, name: 'WSTe — Waste Service Tracking' })).toBeInTheDocument();
    expect(within(grid).getAllByText('LIVE')).toHaveLength(13);
    expect(within(grid).getByText('Cost per tonne').tagName).toBe('LI');
    expect(screen.getByText('13 dashboards available and ready to open.', { exact: false })).toBeInTheDocument();
  });

  it('category filter keeps its behaviour and exposes the selected state via aria-pressed', async () => {
    const { user, container } = renderBrainbase(<DashboardsPage />, { theme });
    const group = screen.getByRole('group', { name: 'Filter dashboards by category' });
    const all = within(group).getByRole('button', { name: /^All\s*13$/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');

    const utilities = within(group).getByRole('button', { name: /^Utilities\s*2$/ });
    await user.click(utilities);
    expect(utilities).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('heading', { level: 2, name: 'Utilities' })).toBeInTheDocument();
    const grid = screen.getByRole('region', { name: 'Dashboards' });
    expect(within(grid).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/dashboard/water', '/dashboard/environment']);
    expect(screen.getByText(/2 dashboards available/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('footer keeps its Command Centre and Home links; decorative arrows are hidden', () => {
    const { container } = renderBrainbase(<DashboardsPage />, { theme });
    expect(screen.getByRole('link', { name: 'Open Command Centre' })).toHaveAttribute('href', '/command');
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    for (const el of Array.from(container.querySelectorAll('span')).filter(s => s.textContent === '↗' || s.textContent === '→')) {
      expect(el).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
