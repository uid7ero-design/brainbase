import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase B — authenticated application chrome (TopNav's AppNav). Behaviour
// proof for the keyboard-operable Operations / Admin menus, the single
// active-state language, the theme control and the profile cluster.
// Navigation gating itself stays covered by the containment suites.

let mockPathname = '/command';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const { default: TopNav } = await import('@/components/nav/TopNav');

type ServerSession = Parameters<typeof TopNav>[0]['serverSession'];

const HQ_SUPER_ADMIN: ServerSession = {
  role: 'super_admin',
  name: 'Alex Morgan',
  enabledCapabilities: ['crm', 'events'],
  dashboardVariant: 'brainbase-hq',
};

function renderNav(session: ServerSession = HQ_SUPER_ADMIN, theme: 'light' | 'dark' = 'dark') {
  return renderBrainbase(
    <ThemeProvider>
      <TopNav serverSession={session} />
    </ThemeProvider>,
    { theme },
  );
}

beforeEach(() => {
  mockPathname = '/command';
});

describe('AppNav chrome', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderNav(HQ_SUPER_ADMIN, theme);
    await expectNoAxeViolations(container);
  });

  it('is a labelled navigation landmark with the product lockup as a named home link', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'BrainBase home' })).toHaveAttribute('href', '/');
  });

  it('marks the current destination with aria-current, not colour alone', () => {
    mockPathname = '/crm/companies';
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'CRM' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Command' })).not.toHaveAttribute('aria-current');
  });

  it('Operations opens from the keyboard, moves focus into the menu, and Escape returns focus to the trigger', async () => {
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: 'Operations' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('navigation', { name: 'Operations' });
    expect(within(menu).getByRole('link', { name: /Waste/ })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('link', { name: /Fleet/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(within(menu).getByRole('link', { name: /All dashboards/ })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Operations' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closing on scroll never strands keyboard focus on the page body', async () => {
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: 'Operations' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('navigation', { name: 'Operations' })).getByRole('link', { name: /Waste/ })).toHaveFocus();

    fireEvent.scroll(window);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('ArrowDown on a closed trigger opens the menu at its first item', async () => {
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: 'Admin' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const menu = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(menu).getByRole('link', { name: /Organisations/ })).toHaveFocus();
  });

  it('keeps every Operations and Admin destination (and CRM stays capability-gated)', async () => {
    const { user } = renderNav();
    await user.click(screen.getByRole('button', { name: 'Operations' }));
    const ops = screen.getByRole('navigation', { name: 'Operations' });
    expect(within(ops).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/dashboard/wste',
      '/dashboard/fleet',
      '/dashboard/social',
      '/crm',
      '/dashboards',
    ]);

    await user.click(screen.getByRole('button', { name: 'Admin' }));
    const admin = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(admin).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/admin/orgs',
      '/admin/users',
      '/admin/client-events',
      '/admin/pipeline',
      '/onboarding',
    ]);
  });

  it('omits the capability-gated CRM entry when the organisation lacks it', async () => {
    const { user } = renderNav({ ...HQ_SUPER_ADMIN!, enabledCapabilities: [] });
    await user.click(screen.getByRole('button', { name: 'Operations' }));
    const ops = screen.getByRole('navigation', { name: 'Operations' });
    expect(within(ops).queryByRole('link', { name: /CRM/ })).toBeNull();
  });

  it('a second click or a press outside closes the menu', async () => {
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: 'Admin' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the current menu destination and flags its trigger as active', async () => {
    mockPathname = '/admin/users';
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: 'Admin' });
    expect(trigger).toHaveAttribute('data-active', 'true');
    await user.click(trigger);
    const admin = screen.getByRole('navigation', { name: 'Admin' });
    expect(within(admin).getByRole('link', { name: /Users/ })).toHaveAttribute('aria-current', 'page');
  });

  it('has a named theme control that switches the theme', async () => {
    const { user } = renderNav();
    const toggle = screen.getByRole('button', { name: 'Switch to light theme' });
    await user.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('shows the signed-in identity (name, role, initials fallback), Branding for admins, and Sign out', () => {
    renderNav();
    const profile = screen.getByRole('link', { name: /Alex/ });
    expect(profile).toHaveAttribute('href', '/account/profile');
    expect(within(profile).getByText('Super admin')).toBeInTheDocument();
    expect(within(profile).getByText('AM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Branding' })).toHaveAttribute('href', '/settings/branding');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('does not offer Branding below admin', () => {
    renderNav({ role: 'manager', name: 'Sam Lee', enabledCapabilities: [], dashboardVariant: null });
    expect(screen.queryByRole('link', { name: 'Branding' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Operations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });
});
