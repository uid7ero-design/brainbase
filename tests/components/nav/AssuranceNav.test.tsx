import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Assurance on the consolidated authenticated navigation. Assurance is ONE
// generic Work descriptor (components/nav/navModel.ts); TopNav renders it
// like any other module. Rendered proof: it sits under Work (never a flat
// pill), appears exactly once, only with the 'assurance' capability, for
// generic, HQ and LD Tennis alike; Work is the current section on every
// Assurance route including Help; keyboard, Escape/focus and the mobile Menu
// behave as for every other Work item; the dashboard card follows the same
// model.

let mockPathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const { default: TopNav } = await import('@/components/nav/TopNav');
const { ModuleAccessCard } = await import('@/components/dashboard/ModuleAccessCard');

type ServerSession = NonNullable<Parameters<typeof TopNav>[0]['serverSession']>;

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

const primary = () => screen.getByRole('navigation', { name: 'Primary' });
const labelOf = (el: Element) => el.querySelector('.menuLabel')?.textContent ?? el.textContent ?? '';
const item = (label: string) => (_name: string, el: Element) => labelOf(el) === label;
const assuranceLinks = () => screen.queryAllByRole('link').filter(a => labelOf(a) === 'Assurance' || a.getAttribute('href') === '/assurance');

async function openWork(user: ReturnType<typeof renderNav>['user']) {
  const trigger = within(primary()).getByRole('button', { name: /Work/ });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return { trigger, menu: screen.getByRole('navigation', { name: 'Work' }) };
}

beforeEach(() => {
  mockPathname = '/dashboard';
});

describe('Assurance under Work — desktop', () => {
  it('entitled generic client: exactly one Assurance link, inside the Work menu only', async () => {
    const { user } = renderNav(persona('viewer', { enabledCapabilities: ['assurance'] }));
    // Closed menus: no flat Assurance pill anywhere in the bar.
    expect(assuranceLinks()).toHaveLength(0);
    const { menu } = await openWork(user);
    const link = within(menu).getByRole('link', { name: item('Assurance') });
    expect(link).toHaveAttribute('href', '/assurance');
    expect(assuranceLinks()).toEqual([link]);
  });

  it('not entitled: no Assurance anywhere (and a viewer with nothing else gets no Work trigger)', async () => {
    const a = renderNav(persona('admin', { enabledCapabilities: ['events', 'crm'] }));
    const { menu } = await openWork(a.user);
    expect(within(menu).queryByRole('link', { name: item('Assurance') })).toBeNull();
    expect(assuranceLinks()).toHaveLength(0);
    a.unmount();
    renderNav(persona('viewer'));
    expect(within(primary()).queryByRole('button', { name: /Work/ })).toBeNull();
    expect(assuranceLinks()).toHaveLength(0);
  });

  it('analyst fails closed even with the capability (the route refuses analyst too)', () => {
    renderNav(persona('analyst', { enabledCapabilities: ['assurance'] }));
    expect(within(primary()).queryByRole('button', { name: /Work/ })).toBeNull();
    expect(assuranceLinks()).toHaveLength(0);
  });

  it('HQ super_admin: Assurance follows the same Work model (in Work, not Brainbase)', async () => {
    const { user } = renderNav(persona('super_admin', { enabledCapabilities: ['assurance', 'crm'], dashboardVariant: 'brainbase-hq', organisationName: 'Brainbase' }));
    const { menu } = await openWork(user);
    expect(within(menu).getByRole('link', { name: item('Assurance') })).toHaveAttribute('href', '/assurance');
    await user.keyboard('{Escape}');
    const bb = within(primary()).getByRole('button', { name: 'Brainbase' });
    bb.focus();
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('navigation', { name: 'Brainbase' })).queryByRole('link', { name: item('Assurance') })).toBeNull();
  });

  it('HQ super_admin viewing an org WITHOUT the capability: absent (no role bypass)', () => {
    renderNav(persona('super_admin', { enabledCapabilities: ['crm'], dashboardVariant: 'brainbase-hq' }));
    expect(assuranceLinks()).toHaveLength(0);
  });

  it('LD Tennis: generic entry beside the Tennis group when entitled; absent otherwise', async () => {
    const t = renderNav(persona('manager', { enabledCapabilities: ['assurance'], dashboardVariant: 'ld-tennis', organisationName: 'LD Tennis' }));
    const { menu } = await openWork(t.user);
    expect(within(menu).getByRole('link', { name: item('Assurance') })).toHaveAttribute('href', '/assurance');
    expect(within(menu).getByRole('list', { name: 'Tennis' })).toBeInTheDocument();
    t.unmount();
    const u = renderNav(persona('manager', { enabledCapabilities: [], dashboardVariant: 'ld-tennis', organisationName: 'LD Tennis' }));
    const w = await openWork(u.user);
    expect(within(w.menu).queryByRole('link', { name: item('Assurance') })).toBeNull();
  });

  it('keyboard: arrows reach Assurance, Escape closes and focus returns to Work', async () => {
    const { user } = renderNav(persona('manager', { enabledCapabilities: ['crm', 'assurance'] }));
    const { trigger, menu } = await openWork(user);
    expect(within(menu).getByRole('link', { name: item('CRM') })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('link', { name: item('Assurance') })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe('active state — Work owns every Assurance route, including Help', () => {
  it.each([
    '/assurance', '/assurance/incidents', '/assurance/incidents/abc', '/assurance/investigations', '/assurance/inspections',
    '/assurance/inspections/templates', '/assurance/templates', '/assurance/audits', '/assurance/findings', '/assurance/actions',
    '/assurance/evidence', '/assurance/verification', '/assurance/help', '/assurance/help/user-guide',
    '/assurance/help/perform-verification',
  ])('%s → Work current, Assurance aria-current', async path => {
    mockPathname = path;
    const { user } = renderNav(persona('viewer', { enabledCapabilities: ['assurance', 'events'] }));
    const work = within(primary()).getByRole('button', { name: /Work/ });
    expect(work).toHaveAttribute('data-active', 'true');
    expect(work).toHaveTextContent('(current section)');
    const { menu } = await openWork(user);
    expect(within(menu).getByRole('link', { name: item('Assurance') })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('link', { name: item('Events & Ticketing') })).not.toHaveAttribute('aria-current');
  });

  it('not entitled: /assurance is not claimed by the chrome', () => {
    mockPathname = '/assurance';
    renderNav(persona('viewer', { enabledCapabilities: ['events'] }));
    expect(within(primary()).getByRole('button', { name: /Work/ })).not.toHaveAttribute('data-active');
  });
});

describe('mobile Menu (≤767px)', () => {
  let phone: HTMLStyleElement;
  beforeEach(() => {
    phone = document.createElement('style');
    phone.textContent = '.desktopOnly{display:none !important}.mobileOnly{display:flex !important}';
    document.head.appendChild(phone);
    return () => phone.remove();
  });

  it('Assurance appears once, in the Work section; Escape closes and returns focus', async () => {
    mockPathname = '/assurance/help';
    const { user } = renderNav(persona('viewer', { enabledCapabilities: ['assurance'] }));
    const trigger = within(primary()).getByRole('button', { name: 'Menu' });
    await user.click(trigger);
    const panel = screen.getByRole('navigation', { name: 'Main menu' });
    const links = within(panel).getAllByRole('link').filter(a => labelOf(a) === 'Assurance');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/assurance');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(within(panel).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toContain('Work');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('not entitled: the mobile menu has no Assurance', async () => {
    const { user } = renderNav(persona('admin', { enabledCapabilities: ['events'] }));
    await user.click(within(primary()).getByRole('button', { name: 'Menu' }));
    const panel = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(panel).queryAllByRole('link').filter(a => labelOf(a) === 'Assurance')).toHaveLength(0);
  });
});

describe('dashboard "Your tools" card', () => {
  it('shows an Assurance card only when entitled, linking to /assurance', () => {
    const r = renderBrainbase(<ModuleAccessCard enabledCapabilities={['assurance']} role="viewer" />);
    const link = screen.getByRole('link', { name: /Assurance/ });
    expect(link).toHaveAttribute('href', '/assurance');
    expect(link).toHaveTextContent('Incidents, inspections, audits and corrective actions');
    r.unmount();
    renderBrainbase(<ModuleAccessCard enabledCapabilities={['events']} role="viewer" />);
    expect(screen.queryByRole('link', { name: /Assurance/ })).toBeNull();
  });
});

describe('accessibility (axe)', () => {
  it.each(['light', 'dark'] as const)('open Work menu with Assurance current has no violations (%s)', async theme => {
    mockPathname = '/assurance/findings';
    const { user, container } = renderNav(persona('manager', { enabledCapabilities: ['assurance', 'events'] }), theme);
    await openWork(user);
    await expectNoAxeViolations(container);
  });
});
