import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Authenticated navigation consolidation (feat/authenticated-nav-consolidation).
// Rendered proof that the ONE TopNav render path shows each persona the tree
// components/nav/navModel.ts resolves for it — Home · HLNA · Work ▾ ·
// Requests · Manage ▾ · Brainbase ▾ (real super_admin only) · Account ▾ —
// and that the desktop disclosure menus and the ≤767px Menu panel are
// keyboard and screen-reader operable. jsdom applies no CSS, so the desktop
// row and the mobile Menu button are both in the DOM; each is queried by
// its own accessible name.

let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const { default: TopNav } = await import('@/components/nav/TopNav');
const { ModuleAccessCard } = await import('@/components/dashboard/ModuleAccessCard');

type ServerSession = NonNullable<Parameters<typeof TopNav>[0]['serverSession']>;

const HQ_SUPER_ADMIN: ServerSession = {
  role: 'super_admin',
  name: 'Alex Morgan',
  enabledCapabilities: ['crm', 'events'],
  dashboardVariant: 'brainbase-hq',
  organisationName: 'Brainbase',
};

// A super_admin viewing a client organisation through the org switcher: the
// role stays the REAL role, capabilities/variant describe the org in view.
const IMPERSONATING_GENERIC: ServerSession = {
  role: 'super_admin',
  name: 'Alex Morgan',
  enabledCapabilities: ['events', 'organiser'],
  dashboardVariant: null,
  organisationName: 'Northside Council',
};

const IMPERSONATING_TENNIS: ServerSession = {
  role: 'super_admin',
  name: 'Alex Morgan',
  enabledCapabilities: [],
  dashboardVariant: 'ld-tennis',
  organisationName: 'LD Tennis',
};

const persona = (role: string, extra: Partial<ServerSession> = {}): ServerSession => ({
  role,
  name: 'Sam Lee',
  enabledCapabilities: [],
  dashboardVariant: null,
  organisationName: 'Northside Council',
  ...extra,
});

function renderNav(session: ServerSession, theme: 'light' | 'dark' = 'dark') {
  return renderBrainbase(
    <ThemeProvider>
      <TopNav serverSession={session} />
    </ThemeProvider>,
    { theme },
  );
}

function primary() {
  return screen.getByRole('navigation', { name: 'Primary' });
}

async function openMenu(user: ReturnType<typeof renderNav>['user'], name: string | RegExp) {
  const trigger = within(primary()).getByRole('button', { name });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return trigger;
}

// Menu links carry a description after the label, and both form the
// accessible name; match on the visible label (pills have no description).
function labelOf(el: Element) {
  return el.querySelector('.menuLabel')?.textContent ?? el.textContent ?? '';
}
function item(label: string) {
  return (_name: string, el: Element) => labelOf(el) === label;
}
function linkNames(container: HTMLElement) {
  return within(container).getAllByRole('link').map(labelOf);
}

beforeEach(() => {
  mockPathname = '/dashboard';
});

describe('universal desktop bar', () => {
  it('HQ super_admin: Home, HLNA, Work, Manage, Brainbase and Account — no Requests (hidden for HQ as before)', () => {
    renderNav(HQ_SUPER_ADMIN);
    const nav = primary();
    expect(within(nav).getByRole('link', { name: item('Home') })).toHaveAttribute('href', '/dashboard');
    expect(within(nav).getByRole('link', { name: item('HLNA') })).toHaveAttribute('href', '/hlna');
    for (const name of ['Work', 'Manage', 'Brainbase']) {
      expect(within(nav).getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(within(nav).getByRole('button', { name: /account menu/ })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Requests' })).toBeNull();
  });

  it('generic viewer: no Manage and no Brainbase trigger; Requests links to /dashboard/pipeline', () => {
    renderNav(persona('viewer', { enabledCapabilities: ['events'] }));
    const nav = primary();
    expect(within(nav).getByRole('link', { name: item('Requests') })).toHaveAttribute('href', '/dashboard/pipeline');
    expect(within(nav).queryByRole('button', { name: 'Manage' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'Brainbase' })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Work' })).toBeInTheDocument();
  });

  it('a viewer with no Work destinations gets no empty Work trigger', () => {
    renderNav(persona('viewer'));
    expect(within(primary()).queryByRole('button', { name: 'Work' })).toBeNull();
  });

  it.each(['admin', 'manager', 'viewer', 'analyst'])('%s never sees the Brainbase menu', role => {
    renderNav(persona(role, { enabledCapabilities: ['crm', 'events', 'organiser', 'people', 'quotes'] }));
    expect(within(primary()).queryByRole('button', { name: 'Brainbase' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Founder OS/ })).toBeNull();
  });
});

describe('Work menu', () => {
  it('lists capability-enabled modules, Events labelled "Events & Ticketing"', async () => {
    const { user } = renderNav(persona('admin', { enabledCapabilities: ['events', 'crm', 'invoicing', 'organiser', 'people'] }));
    await openMenu(user, 'Work');
    const menu = screen.getByRole('navigation', { name: 'Work' });
    expect(linkNames(menu)).toEqual(['Events & Ticketing', 'CRM', 'Commercial', 'Organiser', 'People', 'Data Hub']);
    expect(within(menu).getByRole('link', { name: item('Data Hub') })).toHaveAttribute('href', '/data-hub/import');
    expect(within(menu).queryByRole('link', { name: /Sources/ })).toBeNull();
  });

  it('Organiser needs the capability AND manager+', async () => {
    const viewer = renderNav(persona('viewer', { enabledCapabilities: ['organiser', 'events'] }));
    await openMenu(viewer.user, 'Work');
    expect(within(screen.getByRole('navigation', { name: 'Work' })).queryByRole('link', { name: 'Organiser' })).toBeNull();
    viewer.unmount();

    const manager = renderNav(persona('manager', { enabledCapabilities: ['organiser'] }));
    await openMenu(manager.user, 'Work');
    expect(within(screen.getByRole('navigation', { name: 'Work' })).getByRole('link', { name: item('Organiser') }))
      .toHaveAttribute('href', '/organiser');
  });

  it('keyboard: Enter focuses the first item, arrows/Home/End move, Escape closes and returns focus', async () => {
    const { user } = renderNav(persona('admin', { enabledCapabilities: ['events', 'crm', 'people'] }));
    const trigger = await openMenu(user, 'Work');
    const menu = screen.getByRole('navigation', { name: 'Work' });
    expect(trigger).toHaveAttribute('aria-controls', menu.parentElement!.id);
    expect(within(menu).getByRole('link', { name: item('Events & Ticketing') })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('link', { name: item('CRM') })).toHaveFocus();
    await user.keyboard('{End}');
    expect(within(menu).getByRole('link', { name: item('Data Hub') })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(within(menu).getByRole('link', { name: item('Events & Ticketing') })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(within(menu).getByRole('link', { name: item('Data Hub') })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('ArrowUp on the closed trigger opens on the last item', async () => {
    const { user } = renderNav(persona('admin', { enabledCapabilities: ['events', 'crm'] }));
    const trigger = within(primary()).getByRole('button', { name: 'Work' });
    trigger.focus();
    await user.keyboard('{ArrowUp}');
    expect(within(screen.getByRole('navigation', { name: 'Work' })).getByRole('link', { name: item('Data Hub') })).toHaveFocus();
  });

  it('closes on an outside press', async () => {
    const { user } = renderNav(persona('admin', { enabledCapabilities: ['events'] }));
    await openMenu(user, 'Work');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
  });

  it('uses the disclosure pattern — never role=menu / menuitem', async () => {
    const { user } = renderNav(HQ_SUPER_ADMIN);
    await openMenu(user, 'Brainbase');
    expect(document.querySelector('[role="menu"], [role="menuitem"], [role="menubar"]')).toBeNull();
  });
});

describe('LD Tennis on the universal nav', () => {
  it('no separate branch: Home, HLNA → /hlna, Requests, and a Tennis group in Work', async () => {
    const { user } = renderNav(persona('viewer', { dashboardVariant: 'ld-tennis', organisationName: 'LD Tennis' }));
    const nav = primary();
    expect(within(nav).getByRole('link', { name: item('Home') })).toHaveAttribute('href', '/dashboard');
    expect(within(nav).getByRole('link', { name: item('HLNA') })).toHaveAttribute('href', '/hlna');
    expect(within(nav).getByRole('link', { name: item('Requests') })).toBeInTheDocument();
    await openMenu(user, 'Work');
    const menu = screen.getByRole('navigation', { name: 'Work' });
    const tennis = within(menu).getByRole('list', { name: 'Tennis' });
    expect(within(tennis).getAllByRole('link').map(a => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Leads', '/dashboard/leads'],
      ['Squad', '/dashboard/contacts'],
      ['Sessions', '/dashboard/sessions'],
      ['Blog', '/dashboard/blog'],
    ]);
  });

  it('a non-tennis tenant never gets the Tennis group', async () => {
    const { user } = renderNav(persona('admin', { enabledCapabilities: ['events'] }));
    await openMenu(user, 'Work');
    expect(within(screen.getByRole('navigation', { name: 'Work' })).queryByRole('list', { name: 'Tennis' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Squad' })).toBeNull();
  });
});

describe('super_admin impersonation', () => {
  it('viewing a client org: Work follows that org, Brainbase stays, Requests returns', async () => {
    const { user } = renderNav(IMPERSONATING_GENERIC);
    const nav = primary();
    expect(within(nav).getByRole('link', { name: item('Requests') })).toBeInTheDocument();
    await openMenu(user, 'Work');
    expect(linkNames(screen.getByRole('navigation', { name: 'Work' })))
      // People: the approved super_admin bypass of the people capability.
      .toEqual(['Events & Ticketing', 'Organiser', 'People', 'Data Hub']);
    await user.keyboard('{Escape}');
    await openMenu(user, 'Brainbase');
    const bb = screen.getByRole('navigation', { name: 'Brainbase' });
    expect(within(bb).getByRole('link', { name: item('Founder OS') })).toHaveAttribute('href', '/admin/founder');
    expect(within(bb).getByRole('link', { name: item('Client requests') })).toHaveAttribute('href', '/admin/pipeline');
  });

  it('viewing LD Tennis: Brainbase does not depend on dashboardVariant', () => {
    renderNav(IMPERSONATING_TENNIS);
    expect(within(primary()).getByRole('button', { name: 'Brainbase' })).toBeInTheDocument();
  });

  it('Brainbase menu groups Operations, Data & reports and Platform', async () => {
    const { user } = renderNav(HQ_SUPER_ADMIN);
    await openMenu(user, 'Brainbase');
    const bb = screen.getByRole('navigation', { name: 'Brainbase' });
    const hrefs = (name: string) =>
      within(within(bb).getByRole('list', { name })).getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs('Operations')).toEqual(['/dashboard/wste', '/dashboard/fleet', '/dashboard/social', '/dashboards']);
    expect(hrefs('Data & reports')).toEqual(['/data', '/reports']);
    expect(hrefs('Platform')).toEqual(['/admin/orgs', '/admin/users', '/admin/client-events', '/onboarding']);
    // The old Operations "CRM" duplicate is gone — CRM lives in Work only.
    expect(within(bb).queryByRole('link', { name: 'CRM' })).toBeNull();
  });
});

describe('Manage menu', () => {
  it.each([
    ['viewer', null],
    ['analyst', null],
    ['manager', ['Integrations']],
    ['admin', ['Integrations', 'Branding']],
    ['super_admin', ['Integrations', 'Branding']],
  ] as const)('%s → %j', async (role, expected) => {
    const { user } = renderNav(persona(role));
    if (expected === null) {
      expect(within(primary()).queryByRole('button', { name: 'Manage' })).toBeNull();
      return;
    }
    await openMenu(user, 'Manage');
    const menu = screen.getByRole('navigation', { name: 'Manage' });
    expect(linkNames(menu)).toEqual(expected);
    if ((expected as readonly string[]).includes('Branding')) {
      expect(within(menu).getByRole('link', { name: item('Branding') })).toHaveAttribute('href', '/settings/branding');
    }
    expect(within(menu).getByRole('link', { name: item('Integrations') })).toHaveAttribute('href', '/dashboard/integrations');
  });
});

describe('Account menu', () => {
  it('shows identity and organisation, My profile, theme control and Sign out — no Branding', async () => {
    const { user } = renderNav(persona('admin', { organisationName: 'Northside Council' }));
    await openMenu(user, /account menu/);
    const menu = screen.getByRole('navigation', { name: 'Account' });
    expect(within(menu).getByText('Sam Lee')).toBeInTheDocument();
    expect(within(menu).getByText('Admin')).toBeInTheDocument();
    expect(within(menu).getByText('Northside Council')).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: item('My profile') })).toHaveAttribute('href', '/account/profile');
    expect(within(menu).getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Branding' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Profile$/ })).toBeNull();
  });

  it('the theme control toggles <html data-theme> and relabels itself', async () => {
    const { user } = renderNav(persona('viewer'), 'dark');
    await openMenu(user, /account menu/);
    const toggle = screen.getByRole('button', { name: 'Switch to light theme' });
    await user.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('omits the organisation line when the name is unknown (fail closed)', async () => {
    const { user } = renderNav(persona('viewer', { organisationName: null }));
    await openMenu(user, /account menu/);
    expect(within(screen.getByRole('navigation', { name: 'Account' })).queryByText('Organisation')).toBeNull();
  });
});

describe('active state', () => {
  it('/data-hub/import: Work is the current section and Data Hub is current — Brainbase Data is not', async () => {
    mockPathname = '/data-hub/import';
    const { user } = renderNav(HQ_SUPER_ADMIN);
    const work = within(primary()).getByRole('button', { name: /Work/ });
    expect(work).toHaveAttribute('data-active', 'true');
    expect(work).toHaveTextContent('(current section)');
    const bbTrigger = within(primary()).getByRole('button', { name: 'Brainbase' });
    expect(bbTrigger).not.toHaveAttribute('data-active');
    await openMenu(user, /Work/);
    expect(within(screen.getByRole('navigation', { name: 'Work' })).getByRole('link', { name: item('Data Hub') }))
      .toHaveAttribute('aria-current', 'page');
    await user.keyboard('{Escape}');
    await openMenu(user, 'Brainbase');
    expect(within(screen.getByRole('navigation', { name: 'Brainbase' })).getByRole('link', { name: item('Data') }))
      .not.toHaveAttribute('aria-current');
  });

  it('Home is exact: /dashboard/pipeline marks Requests, not Home', () => {
    mockPathname = '/dashboard/pipeline';
    renderNav(persona('viewer'));
    expect(within(primary()).getByRole('link', { name: item('Requests') })).toHaveAttribute('aria-current', 'page');
    expect(within(primary()).getByRole('link', { name: item('Home') })).not.toHaveAttribute('aria-current');
  });

  it('/dashboard marks Home current', () => {
    renderNav(persona('viewer'));
    expect(within(primary()).getByRole('link', { name: item('Home') })).toHaveAttribute('aria-current', 'page');
  });
});

describe('mobile Menu (≤767px)', () => {
  // jsdom applies the CSS module but not media queries: reproduce the
  // ≤767px rules (AppChrome.module.css) so the Menu button is exposed and
  // the desktop row is not, exactly as on a phone.
  let phone: HTMLStyleElement;
  beforeEach(() => {
    phone = document.createElement('style');
    phone.textContent = '.desktopOnly{display:none !important}.mobileOnly{display:flex !important}';
    document.head.appendChild(phone);
    return () => phone.remove();
  });

  it('the desktop row carries no inline display that would defeat the ≤767px hide', () => {
    // Found in browser verification: an inline `display: flex` on the row
    // overrode `.desktopOnly{display:none}` and left it visible on phones.
    renderNav(HQ_SUPER_ADMIN);
    const row = primary().querySelector('.desktopOnly') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.display).toBe('');
  });

  it('the desktop row and Account trigger are hidden; only the Menu control remains', () => {
    renderNav(HQ_SUPER_ADMIN);
    expect(within(primary()).queryByRole('button', { name: 'Work' })).toBeNull();
    expect(within(primary()).queryByRole('button', { name: /account menu/ })).toBeNull();
    expect(within(primary()).getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  async function openMobile(session: ServerSession) {
    const r = renderNav(session);
    const trigger = within(primary()).getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await r.user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('navigation', { name: 'Main menu' });
    expect(trigger).toHaveAttribute('aria-controls', panel.parentElement!.id);
    return { ...r, trigger, panel };
  }

  it('renders the same tree: identity, Home/HLNA/Requests, then Work, Manage, Account sections', async () => {
    const { panel } = await openMobile(persona('admin', { enabledCapabilities: ['events'] }));
    expect(within(panel).getByText('Sam Lee')).toBeInTheDocument();
    expect(within(panel).getByText('Northside Council')).toBeInTheDocument();
    expect(within(panel).getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual(['Work', 'Manage', 'Account']);
    expect(within(panel).getByRole('link', { name: item('HLNA') })).toHaveAttribute('href', '/hlna');
    expect(within(panel).getByRole('link', { name: item('Branding') })).toHaveAttribute('href', '/settings/branding');
  });

  it('Brainbase section only for a real super_admin', async () => {
    const admin = await openMobile(persona('admin'));
    expect(within(admin.panel).queryByRole('heading', { name: 'Brainbase' })).toBeNull();
    admin.unmount();
    const founder = await openMobile(IMPERSONATING_TENNIS);
    expect(within(founder.panel).getByRole('heading', { name: 'Brainbase' })).toBeInTheDocument();
    expect(within(founder.panel).getByRole('list', { name: 'Tennis' })).toBeInTheDocument();
  });

  it('focus moves in, Tab/Shift+Tab stay inside, Escape closes and returns focus', async () => {
    const { user, trigger, panel } = await openMobile(persona('viewer', { enabledCapabilities: ['events'] }));
    const first = within(panel).getByRole('link', { name: item('Home') });
    const last = within(panel).getByRole('button', { name: 'Sign out' });
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('a client-side navigation (pathname change) closes the panel', async () => {
    const { rerender } = await openMobile(persona('viewer'));
    mockPathname = '/hlna';
    rerender(
      <ThemeProvider>
        <TopNav serverSession={persona('viewer')} />
      </ThemeProvider>,
    );
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    expect(within(primary()).getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside press and when a destination is chosen', async () => {
    const { user, panel } = await openMobile(persona('viewer'));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    void panel;
    await user.click(within(primary()).getByRole('button', { name: 'Menu' }));
    const home = within(screen.getByRole('navigation', { name: 'Main menu' })).getByRole('link', { name: item('Home') });
    home.addEventListener('click', e => e.preventDefault());
    await user.click(home);
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
  });
});

describe('accessibility (axe)', () => {
  it.each(['light', 'dark'] as const)('closed bar has no violations (%s)', async theme => {
    const { container } = renderNav(HQ_SUPER_ADMIN, theme);
    await expectNoAxeViolations(container);
  });

  it.each([
    ['Work', 'light'],
    ['Brainbase', 'dark'],
    ['Manage', 'light'],
    [/account menu/, 'dark'],
  ] as const)('open %s menu has no violations (%s)', async (name, theme) => {
    const { user } = renderNav(HQ_SUPER_ADMIN, theme);
    await openMenu(user, name);
    await expectNoAxeViolations(document.body);
  });

  it.each(['light', 'dark'] as const)('open mobile Menu has no violations (%s)', async theme => {
    const phone = document.createElement('style');
    phone.textContent = '.desktopOnly{display:none !important}.mobileOnly{display:flex !important}';
    document.head.appendChild(phone);
    const { user } = renderNav(IMPERSONATING_TENNIS, theme);
    await user.click(within(primary()).getByRole('button', { name: 'Menu' }));
    await expectNoAxeViolations(document.body);
    phone.remove();
  });
});

describe('ModuleAccessCard derives from the same model', () => {
  it('manager: first-class Work modules only — no Data Hub, Tennis, Manage, Brainbase or Account items', () => {
    renderBrainbase(
      <ModuleAccessCard
        role="manager"
        dashboardVariant="ld-tennis"
        enabledCapabilities={['events', 'crm', 'purchasing', 'organiser', 'people']}
      />,
    );
    const section = screen.getByRole('region', { name: 'Your Tools' });
    const hrefs = within(section).getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/events', '/crm', '/commercial', '/organiser', '/people']);
    expect(within(section).getByText('Events & Ticketing')).toBeInTheDocument();
  });

  it('viewer with organiser gets no Organiser card; without a role, role-gated modules fail closed', () => {
    const { unmount } = renderBrainbase(<ModuleAccessCard role="viewer" enabledCapabilities={['organiser', 'crm']} />);
    expect(screen.queryByRole('link', { name: /Organiser/ })).toBeNull();
    expect(screen.getByRole('link', { name: /CRM/ })).toBeInTheDocument();
    unmount();
    renderBrainbase(<ModuleAccessCard enabledCapabilities={['organiser']} />);
    expect(screen.queryByRole('region', { name: 'Your Tools' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = renderBrainbase(
      <ModuleAccessCard role="admin" enabledCapabilities={['events', 'crm', 'quotes', 'organiser', 'people']} />,
    );
    await expectNoAxeViolations(container);
  });
});
