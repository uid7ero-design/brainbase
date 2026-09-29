import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase B â€” authenticated application chrome (TopNav's AppNav). Behaviour
// proof for the keyboard-operable Operations / Admin menus, the single
// active-state language, the theme control and the profile cluster.
// Navigation gating itself stays covered by the containment suites.
//
// Nav consolidation update (feat/authenticated-nav-consolidation): the
// bespoke Operations / Admin dropdowns became ONE generic NavMenu rendering
// Work, Manage, Brainbase (real super_admin only) and Account (avatar
// trigger: identity summary, My profile, theme toggle, Sign out); <=767px a
// single "Menu" button renders the same resolved tree. The same rendered
// behavioural assertions are re-targeted at that structure below. jsdom
// applies no CSS, so the desktop menus and the mobile Menu trigger are both
// present; panels are portaled to document.body, so they are queried from
// `screen`, not from inside the Primary landmark.

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

  it('marks the current destination with aria-current, not colour alone', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): CRM now
    // lives in the Work menu, so the Work trigger is flagged active (with a
    // non-colour "(current section)" text cue) and the CRM link inside the
    // opened panel carries aria-current; Command (Brainbase menu) and the
    // top-level Home pill do not.
    mockPathname = '/crm/companies';
    const { user } = renderNav();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    const work = within(nav).getByRole('button', { name: /^Work\s*\(current section\)$/ });
    expect(work).toHaveAttribute('data-active', 'true');
    await user.click(work);
    const workMenu = screen.getByRole('navigation', { name: 'Work' });
    expect(within(workMenu).getByRole('link', { name: /CRM/ })).toHaveAttribute('aria-current', 'page');
    expect(within(workMenu).getByRole('link', { name: /Events & Ticketing/ })).not.toHaveAttribute('aria-current');

    const brainbase = within(nav).getByRole('button', { name: 'Brainbase' });
    expect(brainbase).not.toHaveAttribute('data-active');
    await user.click(brainbase);
    const bbMenu = screen.getByRole('navigation', { name: 'Brainbase' });
    expect(within(bbMenu).getByRole('link', { name: 'Command' })).not.toHaveAttribute('aria-current');
  });

  it('Operations opens from the keyboard, moves focus into the menu, and Escape returns focus to the trigger', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation):
    // Operations is now a group inside the Brainbase menu, which starts with
    // Founder OS and ends with Platform › Setup.
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: /^Brainbase/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('navigation', { name: 'Brainbase' });
    expect(trigger).toHaveAttribute('aria-controls', menu.parentElement!.id);
    expect(within(menu).getByRole('link', { name: 'Founder OS' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('link', { name: 'Command' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(within(menu).getByRole('link', { name: 'Setup' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(within(menu).getByRole('link', { name: 'Founder OS' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(within(menu).getByRole('link', { name: 'Setup' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Brainbase' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closing on scroll never strands keyboard focus on the page body', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): same
    // proof on the generic NavMenu (Brainbase menu; first item Founder OS).
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: /^Brainbase/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('navigation', { name: 'Brainbase' })).getByRole('link', { name: 'Founder OS' })).toHaveFocus();

    fireEvent.scroll(window);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('ArrowDown on a closed trigger opens the menu at its first item', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): Admin →
    // Brainbase (first item Founder OS); ArrowUp on the closed Manage trigger
    // opens at its LAST item (Branding).
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: /^Brainbase/ });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const menu = screen.getByRole('navigation', { name: 'Brainbase' });
    expect(within(menu).getByRole('link', { name: 'Founder OS' })).toHaveFocus();

    await user.keyboard('{Escape}');
    const manage = screen.getByRole('button', { name: 'Manage' });
    manage.focus();
    await user.keyboard('{ArrowUp}');
    const manageMenu = screen.getByRole('navigation', { name: 'Manage' });
    expect(within(manageMenu).getByRole('link', { name: /Branding/ })).toHaveFocus();
  });

  it('keeps every Operations and Admin destination (and CRM stays capability-gated)', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // former Operations + Admin destinations are all in the Brainbase menu, in
    // this order. APPROVED: the Operations CRM duplicate is gone — CRM is a
    // capability-gated Work entry instead.
    const { user } = renderNav();
    await user.click(screen.getByRole('button', { name: /^Brainbase/ }));
    const bb = screen.getByRole('navigation', { name: 'Brainbase' });
    expect(within(bb).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/admin/founder',
      '/command',
      '/clients',
      '/admin/pipeline',
      '/dashboard/wste',
      '/dashboard/fleet',
      '/dashboard/social',
      '/dashboards',
      '/data',
      '/reports',
      '/admin/orgs',
      '/admin/users',
      '/admin/client-events',
      '/onboarding',
    ]);
    // Grouped lists are named by their visible group heading.
    expect(within(within(bb).getByRole('list', { name: 'Operations' })).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/dashboard/wste',
      '/dashboard/fleet',
      '/dashboard/social',
      '/dashboards',
    ]);
    expect(within(within(bb).getByRole('list', { name: 'Platform' })).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/admin/orgs',
      '/admin/users',
      '/admin/client-events',
      '/onboarding',
    ]);
    expect(within(bb).queryByRole('link', { name: /CRM/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Work' }));
    const work = screen.getByRole('navigation', { name: 'Work' });
    expect(within(work).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual([
      '/events',
      '/crm',
      '/people',
      '/data-hub/import',
    ]);
  });

  it('omits the capability-gated CRM entry when the organisation lacks it', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): CRM
    // lives in Work; without the capability it is in neither Work nor the
    // Brainbase menu.
    const { user } = renderNav({ ...HQ_SUPER_ADMIN!, enabledCapabilities: [] });
    await user.click(screen.getByRole('button', { name: 'Work' }));
    const work = screen.getByRole('navigation', { name: 'Work' });
    expect(within(work).queryByRole('link', { name: /CRM/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Brainbase/ }));
    const bb = screen.getByRole('navigation', { name: 'Brainbase' });
    expect(within(bb).queryByRole('link', { name: /CRM/ })).toBeNull();
  });

  it('a second click or a press outside closes the menu', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): Admin →
    // Brainbase (same generic NavMenu dismissal).
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: /^Brainbase/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the current menu destination and flags its trigger as active', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): Admin →
    // Brainbase; the active trigger also carries the "(current section)" text.
    mockPathname = '/admin/users';
    const { user } = renderNav();
    const trigger = screen.getByRole('button', { name: /^Brainbase\s*\(current section\)$/ });
    expect(trigger).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Work' })).not.toHaveAttribute('data-active');
    await user.click(trigger);
    const bb = screen.getByRole('navigation', { name: 'Brainbase' });
    expect(within(bb).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(within(bb).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('has a named theme control that switches the theme', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // theme control moved into the Account menu (same ThemeProvider).
    const { user } = renderNav();
    await user.click(screen.getByRole('button', { name: /account menu/ }));
    const toggle = screen.getByRole('button', { name: 'Switch to light theme' });
    await user.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('shows the signed-in identity (name, role, initials fallback), Branding for admins, and Sign out', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): the
    // identity is now the Account menu trigger (a button, not the profile
    // link); the opened menu shows the summary (incl. the organisation in
    // view), My profile (/account/profile) and Sign out. Branding moved into
    // the Manage menu.
    const { user } = renderNav({ ...HQ_SUPER_ADMIN!, organisationName: 'Northwind Council' });
    const account = screen.getByRole('button', { name: /account menu/ });
    expect(within(account).getByText('Alex')).toBeInTheDocument();
    expect(within(account).getByText('Super admin')).toBeInTheDocument();
    expect(within(account).getByText('AM')).toBeInTheDocument();

    await user.click(account);
    const menu = screen.getByRole('navigation', { name: 'Account' });
    expect(within(menu).getByText('Alex Morgan')).toBeInTheDocument();
    expect(within(menu).getByText('Northwind Council')).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'My profile' })).toHaveAttribute('href', '/account/profile');
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Manage' }));
    const manage = screen.getByRole('navigation', { name: 'Manage' });
    expect(within(manage).getByRole('link', { name: /Branding/ })).toHaveAttribute('href', '/settings/branding');
  });

  it('does not offer Branding below admin', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): a
    // manager gets Manage › Integrations but not Branding, and no Brainbase
    // menu (nor the retired Operations/Admin triggers) — on desktop or in the
    // mobile Menu.
    const { user } = renderNav({ role: 'manager', name: 'Sam Lee', enabledCapabilities: [], dashboardVariant: null });
    expect(screen.queryByRole('link', { name: /Branding/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Operations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Brainbase/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Manage' }));
    const manage = screen.getByRole('navigation', { name: 'Manage' });
    expect(within(manage).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/dashboard/integrations']);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Menu', hidden: true }));
    const mobile = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(mobile).queryByRole('link', { name: /Branding/ })).toBeNull();
    expect(within(mobile).queryByRole('heading', { name: 'Brainbase' })).toBeNull();
    expect(within(mobile).getByRole('link', { name: /Integrations/ })).toHaveAttribute('href', '/dashboard/integrations');
  });

  it('the ≤767px Menu renders the same resolved tree, traps Tab, and Escape returns focus to it', async () => {
    // Nav consolidation update (feat/authenticated-nav-consolidation): new
    // mobile path — one Menu button over the SAME model as the desktop menus.
    const { user } = renderNav();
    // jsdom applies the CSS module but not its @media (max-width: 767px)
    // swap, so the .mobileOnly wrapper stays display:none here — hence
    // `hidden: true` for the trigger only; the portaled panel is queried as
    // an ordinary accessible landmark.
    const trigger = screen.getByRole('button', { name: 'Menu', hidden: true });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const mobile = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(mobile).getAllByRole('heading').map(h => h.textContent)).toEqual([
      'Work',
      'Manage',
      'Brainbase',
      'Account',
    ]);
    const links = within(mobile).getAllByRole('link');
    expect(links[0]).toHaveFocus();
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      '/dashboard',
      '/hlna',
      '/events',
      '/crm',
      '/people',
      '/data-hub/import',
      '/dashboard/integrations',
      '/settings/branding',
      '/admin/founder',
      '/command',
      '/clients',
      '/admin/pipeline',
      '/dashboard/wste',
      '/dashboard/fleet',
      '/dashboard/social',
      '/dashboards',
      '/data',
      '/reports',
      '/admin/orgs',
      '/admin/users',
      '/admin/client-events',
      '/onboarding',
      '/account/profile',
    ]);
    // Last focusable is Sign out; Tab wraps back to the first item.
    within(mobile).getByRole('button', { name: 'Sign out' }).focus();
    await user.tab();
    expect(links[0]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
