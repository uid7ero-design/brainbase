import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import {
  Button,
  Dialog,
  Metric,
  MetricStrip,
  ModuleNavItem,
  ModuleNavSection,
  ModuleSidebar,
  moduleNavFooterItemClassName,
  moduleNavItemProps,
} from '@/components/ui/app';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase D1 — shared module navigation, dialog, metric strip, and the
// converted Events / Ops surfaces that consume them.

let mockPathname = '/crm/companies';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: CrmSidebar } = await import('@/app/crm/_components/CrmSidebar');
const { default: CommercialSidebar } = await import('@/app/commercial/_components/CommercialSidebar');
const { default: OpsSidebar } = await import('@/components/ops/Sidebar');
const { StatusBadge } = await import('@/app/events/_components/ui');

function ModulePage() {
  return (
    <div style={{ display: 'flex' }}>
      <ModuleSidebar
        title="Admin Panel"
        subtitle="Alex Morgan"
        label="Admin sections"
        footer={<a href="#app" className={moduleNavFooterItemClassName}>← Back to app</a>}
      >
        <a href="/admin/founder" {...moduleNavItemProps(false)}>Founder OS</a>
        <ModuleNavSection>Platform</ModuleNavSection>
        <ModuleNavItem href="/admin/orgs" active>Organisations</ModuleNavItem>
        <ModuleNavItem href="/admin/users" active={false}>Users</ModuleNavItem>
      </ModuleSidebar>
      <main>
        <h1>Organisations</h1>
      </main>
    </div>
  );
}

describe('ModuleSidebar / ModuleNavItem', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<ModulePage />, { theme });
    await expectNoAxeViolations(container);
  });

  it('is a labelled navigation landmark with module identity as typography', () => {
    renderBrainbase(<ModulePage />);
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
  });

  it('marks exactly the current destination with aria-current, for components and hand-written links alike', () => {
    renderBrainbase(<ModulePage />);
    expect(screen.getByRole('link', { name: 'Organisations' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Users' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Founder OS' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Founder OS' }).className).toBe(screen.getByRole('link', { name: 'Users' }).className);
  });
});

describe('CRM and Commercial sidebars on the shared contract', () => {
  it('CRM keeps its items and active rule, now exposed with aria-current', () => {
    mockPathname = '/crm/companies';
    renderBrainbase(<CrmSidebar />);
    const nav = screen.getByRole('navigation', { name: 'CRM sections' });
    expect(within(nav).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/crm',
      '/crm/companies',
      '/crm/contacts',
      '/crm/contacts?classification=EVENT_CONTACT',
      '/crm/deals',
      '/crm/activities',
      '/crm/events-backfill',
    ]);
    expect(within(nav).getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('Commercial keeps capability gating: gated items are omitted, never shown disabled', () => {
    mockPathname = '/commercial/invoices';
    renderBrainbase(<CommercialSidebar quotesEnabled={false} invoicingEnabled purchasingEnabled={false} />);
    const nav = screen.getByRole('navigation', { name: 'Commercial sections' });
    expect(within(nav).queryByRole('link', { name: 'Quotes' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Purchase Orders' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Ops workspace sidebar', () => {
  function renderOps(collapsed = false, pathname = '/command') {
    const onToggle = vi.fn();
    const utils = renderBrainbase(
      <ThemeProvider>
        <OpsSidebar collapsed={collapsed} onToggle={onToggle} pathname={pathname} alertCount={3} />
      </ThemeProvider>,
    );
    return { ...utils, onToggle };
  }

  it('uses the shared active language (aria-current) and names its icon buttons', async () => {
    const { user, onToggle } = renderOps();
    const nav = screen.getByRole('navigation', { name: 'Operations workspace' });
    expect(within(nav).getByRole('link', { name: 'Command Centre' })).toHaveAttribute('aria-current', 'page');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Switch to (light|dark) theme/ })).toBeInTheDocument();
  });

  it('collapsed items keep an accessible name', () => {
    renderOps(true);
    expect(screen.getByRole('link', { name: 'Command Centre' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('the alert indicator is announced as text, not colour alone', () => {
    renderOps(false, '/command/alerts');
    expect(screen.getByText('(active alerts)')).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(
      <ThemeProvider>
        <OpsSidebar collapsed={false} onToggle={() => {}} pathname="/command" />
      </ThemeProvider>,
      { theme },
    );
    await expectNoAxeViolations(container);
  });
});

function DialogHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Edit user</button>
      <Dialog
        open={open}
        title="Edit user"
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <label htmlFor="n">Full name</label>
        <input id="n" />
        <Button type="submit" variant="primary">Save</Button>
      </Dialog>
    </>
  );
}

describe('Dialog (shared centred modal)', () => {
  it('is a labelled modal that focuses its first field, closes on Escape and returns focus', async () => {
    const onClose = vi.fn();
    const { user } = renderBrainbase(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Edit user' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Edit user' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Full name' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('the scrim and the named close button call onClose', async () => {
    const onClose = vi.fn();
    const { user } = renderBrainbase(<DialogHarness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Edit user' }));
    await user.click(screen.getByRole('button', { name: 'Close Edit user' }));
    await user.click(screen.getByRole('button', { name: 'Edit user' }));
    fireEvent.click(document.querySelector('[role="dialog"]')!.previousElementSibling!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each(['light', 'dark'] as const)('has no axe violations when open (%s)', async theme => {
    const { user, container } = renderBrainbase(<DialogHarness />, { theme });
    await user.click(screen.getByRole('button', { name: 'Edit user' }));
    await expectNoAxeViolations(container);
  });
});

describe('MetricStrip', () => {
  function Strip({ loading = false }: { loading?: boolean }) {
    return (
      <main>
        <h1>Event</h1>
        <MetricStrip>
          <Metric label="Orders" value={12} loading={loading} />
          <Metric label="Remaining" value={0} tone="danger" sub="100% booked" loading={loading} />
        </MetricStrip>
      </main>
    );
  }

  it('pairs every value with its label (description list)', () => {
    const { container } = renderBrainbase(<Strip />);
    const terms = Array.from(container.querySelectorAll('dt')).map(n => n.textContent);
    expect(terms).toEqual(['Orders', 'Remaining']);
    expect(container.querySelector('dd[data-tone="danger"]')).toHaveTextContent('0');
    expect(screen.getByText('100% booked')).toBeInTheDocument();
  });

  it('loading shows a neutral placeholder and marks the cell busy (no fake zeroes)', () => {
    const { container } = renderBrainbase(<Strip loading />);
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(2);
    expect(screen.queryByText('12')).toBeNull();
    expect(container.querySelector('[data-tone]')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<Strip />, { theme });
    await expectNoAxeViolations(container);
  });
});

describe('Events StatusBadge → canonical semantic Badge', () => {
  it.each([
    ['success', 'success'],
    ['danger', 'error'],
    ['warning', 'warning'],
    ['neutral', 'inactive'],
  ] as const)('%s tone renders the %s semantic state with its visible label', (tone, state) => {
    renderBrainbase(<StatusBadge label="Published" tone={tone} />);
    const label = screen.getByText('Published');
    expect(label.closest('[data-state]')).toHaveAttribute('data-state', state);
  });
});
