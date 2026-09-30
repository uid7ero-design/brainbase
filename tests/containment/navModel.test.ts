import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BRAINBASE_ITEMS,
  NAV_ROLE_ORDER,
  WORK_ITEMS,
  activeNavId,
  containsActive,
  flattenNavLinks,
  isGateOpen,
  navRoleAtLeast,
  resolveNav,
  workModuleCards,
  type NavContext,
  type NavEntry,
  type NavLink,
} from '@/components/nav/navModel';

// Authenticated navigation consolidation — the persona / capability matrix
// for the pure nav model (components/nav/navModel.ts). This is the parity
// contract the rendered TopNav and the dashboard "Your tools" card both
// consume. Approved behaviour changes vs the old two-branch TopNav are
// called out inline (APPROVED CHANGE).

const ALL_CAPS = ['events', 'crm', 'quotes', 'organiser', 'people'];

function ctx(role: string, caps: string[] = [], dashboardVariant: NavContext['dashboardVariant'] = null): NavContext {
  return { role, enabledCapabilities: caps, dashboardVariant };
}

const ids = (entries: readonly NavEntry[]) =>
  entries.map(e => (e.kind === 'group' ? `${e.id}[${e.children.map(c => c.id).join(',')}]` : e.id));

function summary(c: NavContext) {
  const nav = resolveNav(c);
  return {
    work: ids(nav.work),
    requests: nav.requests?.href ?? null,
    manage: ids(nav.manage),
    brainbase: ids(nav.brainbase),
  };
}

const FULL_BRAINBASE = [
  'founder-os',
  'command',
  'clients',
  'client-requests',
  'operations[ops-waste,ops-fleet,ops-social,ops-all-dashboards]',
  'data-reports[data,reports]',
  'platform[platform-orgs,platform-users,platform-client-events,platform-setup]',
];
const TENNIS = 'tennis[tennis-leads,tennis-squad,tennis-sessions,tennis-blog]';

describe('persona matrix', () => {
  it('generic client viewer: capability modules only; Organiser hidden (manager+); no Data Hub / Manage / Brainbase', () => {
    expect(summary(ctx('viewer', ALL_CAPS))).toEqual({
      work: ['events', 'crm', 'commercial', 'people'],
      requests: '/dashboard/pipeline',
      manage: [],
      brainbase: [],
    });
  });

  it('generic client manager: + Organiser (APPROVED CHANGE: now manager+, matching its layout), + Data Hub, + Manage › Integrations', () => {
    expect(summary(ctx('manager', ALL_CAPS))).toEqual({
      work: ['events', 'crm', 'commercial', 'organiser', 'people', 'data-hub'],
      requests: '/dashboard/pipeline',
      manage: ['integrations'],
      brainbase: [],
    });
  });

  it('generic client admin: + Manage › Branding', () => {
    expect(summary(ctx('admin', ALL_CAPS))).toEqual({
      work: ['events', 'crm', 'commercial', 'organiser', 'people', 'data-hub'],
      requests: '/dashboard/pipeline',
      manage: ['integrations', 'branding'],
      brainbase: [],
    });
  });

  it('Brainbase HQ super_admin: full Brainbase menu, People via bypass, no Requests (hidden for HQ as before)', () => {
    expect(summary(ctx('super_admin', ['crm'], 'brainbase-hq'))).toEqual({
      work: ['crm', 'people', 'data-hub'],
      requests: null,
      manage: ['integrations', 'branding'],
      brainbase: FULL_BRAINBASE,
    });
  });

  it('HQ non-founder staff (brainbase org, not super_admin → no variant): the ordinary client model, no internal tools', () => {
    // lib/dashboard/clientDashboard.ts only yields 'brainbase-hq' for super_admin.
    expect(summary(ctx('manager', ['crm'], null))).toEqual({
      work: ['crm', 'data-hub'],
      requests: '/dashboard/pipeline',
      manage: ['integrations'],
      brainbase: [],
    });
  });

  it('impersonating super_admin viewing a generic org: Work/Manage reflect the viewed org, Brainbase stays (APPROVED CHANGE: no longer variant-dependent)', () => {
    expect(summary(ctx('super_admin', ['events'], null))).toEqual({
      work: ['events', 'people', 'data-hub'],
      requests: '/dashboard/pipeline',
      manage: ['integrations', 'branding'],
      brainbase: FULL_BRAINBASE,
    });
  });

  it('impersonating super_admin viewing LD Tennis: Tennis group + the full Brainbase menu', () => {
    expect(summary(ctx('super_admin', [], 'ld-tennis'))).toEqual({
      work: ['people', 'data-hub', TENNIS],
      requests: '/dashboard/pipeline',
      manage: ['integrations', 'branding'],
      brainbase: FULL_BRAINBASE,
    });
  });

  it('LD Tennis viewer: universal model + the Tennis work group (APPROVED CHANGE: no separate branch)', () => {
    expect(summary(ctx('viewer', ['events'], 'ld-tennis'))).toEqual({
      work: ['events', TENNIS],
      requests: '/dashboard/pipeline',
      manage: [],
      brainbase: [],
    });
  });

  it('LD Tennis manager: + Data Hub, + Organiser when entitled, + Manage › Integrations', () => {
    expect(summary(ctx('manager', ['events', 'organiser'], 'ld-tennis'))).toEqual({
      work: ['events', 'organiser', 'data-hub', TENNIS],
      requests: '/dashboard/pipeline',
      manage: ['integrations'],
      brainbase: [],
    });
  });

  it('LD Tennis admin: + Manage › Branding', () => {
    expect(summary(ctx('admin', ['events'], 'ld-tennis'))).toEqual({
      work: ['events', 'data-hub', TENNIS],
      requests: '/dashboard/pipeline',
      manage: ['integrations', 'branding'],
      brainbase: [],
    });
  });

  it('analyst is unresolved and fails closed: capability-only modules, nothing role-gated', () => {
    expect(summary(ctx('analyst', ALL_CAPS))).toEqual({
      work: ['events', 'crm', 'commercial', 'people'],
      requests: '/dashboard/pipeline',
      manage: [],
      brainbase: [],
    });
  });

  it('an unknown or empty role fails closed exactly like analyst', () => {
    for (const role of ['', 'owner', 'SUPER_ADMIN', 'Admin']) {
      const s = summary(ctx(role, ALL_CAPS));
      expect(s.manage, role).toEqual([]);
      expect(s.brainbase, role).toEqual([]);
      expect(s.work, role).not.toContain('organiser');
      expect(s.work, role).not.toContain('data-hub');
    }
  });

  it('a viewer with no capabilities gets no Work trigger (empty list), but Home/HLNA/Requests/Account remain', () => {
    const nav = resolveNav(ctx('viewer', []));
    expect(nav.work).toEqual([]);
    expect(nav.manage).toEqual([]);
    expect(nav.home.href).toBe('/dashboard');
    expect(nav.hlna.href).toBe('/hlna');
    expect(nav.requests?.href).toBe('/dashboard/pipeline');
    expect(nav.account.profile.href).toBe('/account/profile');
  });
});

describe('capability matrix', () => {
  it.each([['quotes'], ['invoicing'], ['purchasing']])('Commercial shows for %s alone (matches app/commercial/layout.tsx any-of)', cap => {
    expect(summary(ctx('viewer', [cap])).work).toEqual(['commercial']);
  });

  it('each capability maps to exactly its module', () => {
    expect(summary(ctx('viewer', ['events'])).work).toEqual(['events']);
    expect(summary(ctx('viewer', ['crm'])).work).toEqual(['crm']);
    expect(summary(ctx('viewer', ['people'])).work).toEqual(['people']);
    expect(summary(ctx('manager', ['organiser'])).work).toEqual(['organiser', 'data-hub']);
  });

  it('dormant / unrelated keys never create entries', () => {
    expect(summary(ctx('viewer', ['sales', 'expenses', 'budgeting', 'finance_intelligence', 'debtors', 'waste_recycling', 'verity'])).work).toEqual([]);
    // 'assurance' is now a real module key: it creates exactly its own entry.
    expect(summary(ctx('viewer', ['assurance'])).work).toEqual(['assurance']);
  });

  it('Organiser needs BOTH the capability and manager+', () => {
    expect(summary(ctx('viewer', ['organiser'])).work).toEqual([]);
    expect(summary(ctx('manager', [])).work).toEqual(['data-hub']);
    expect(summary(ctx('manager', ['organiser'])).work).toContain('organiser');
  });

  it('People: capability, or the super_admin bypass only', () => {
    expect(summary(ctx('admin', [])).work).not.toContain('people');
    expect(summary(ctx('super_admin', [])).work).toContain('people');
    expect(summary(ctx('viewer', ['people'])).work).toContain('people');
  });

  it('Tennis appears only for the ld-tennis variant — never for generic or HQ organisations', () => {
    for (const v of [null, 'brainbase-hq'] as const) {
      for (const role of ['viewer', 'manager', 'admin', 'super_admin']) {
        expect(summary(ctx(role, ALL_CAPS, v)).work.join(','), `${role}/${v}`).not.toContain('tennis');
      }
    }
  });
});

describe('Brainbase internal menu', () => {
  it('every Brainbase entry and child is gated internal (real super_admin only)', () => {
    for (const e of BRAINBASE_ITEMS) {
      expect(e.gate?.internal, e.id).toBe(true);
      if (e.kind === 'group') for (const c of e.children) expect(c.gate?.internal, c.id).toBe(true);
    }
  });

  it('is visible to super_admin under every variant and to nobody else', () => {
    for (const v of [null, 'ld-tennis', 'brainbase-hq'] as const) {
      expect(summary(ctx('super_admin', [], v)).brainbase, `sa/${v}`).toEqual(FULL_BRAINBASE);
      for (const role of ['admin', 'manager', 'viewer', 'analyst']) {
        expect(summary(ctx(role, ALL_CAPS, v)).brainbase, `${role}/${v}`).toEqual([]);
      }
    }
  });

  it('does not contain the retired Operations CRM duplicate', () => {
    const hrefs = flattenNavLinks(resolveNav(ctx('super_admin', [], 'brainbase-hq'))).map(l => l.href);
    const crmCount = hrefs.filter(h => h === '/crm').length;
    expect(crmCount).toBe(0);
  });
});

describe('routes are unchanged — only their placement moved', () => {
  it('every destination points at an existing canonical route', () => {
    const nav = resolveNav(ctx('super_admin', ALL_CAPS.concat('invoicing', 'purchasing'), 'ld-tennis'));
    const hrefs = flattenNavLinks(nav).map(l => l.href).sort();
    expect(hrefs).toEqual([
      '/account/profile', '/admin/client-events', '/admin/founder', '/admin/orgs', '/admin/pipeline',
      '/admin/users', '/clients', '/command', '/commercial', '/crm', '/dashboard', '/dashboard/blog',
      '/dashboard/contacts', '/dashboard/fleet', '/dashboard/integrations', '/dashboard/leads',
      '/dashboard/pipeline', '/dashboard/sessions', '/dashboard/social', '/dashboard/wste', '/dashboards',
      '/data', '/data-hub/import', '/events', '/hlna', '/onboarding', '/organiser', '/people', '/reports',
      '/settings/branding',
    ].sort());
    for (const href of hrefs) {
      const page = path.join(process.cwd(), 'app', href, 'page.tsx');
      expect(fs.existsSync(page), href).toBe(true);
    }
  });

  it('never links the out-of-scope routes', () => {
    const nav = resolveNav(ctx('super_admin', ALL_CAPS, 'ld-tennis'));
    const hrefs = flattenNavLinks(nav).map(l => l.href);
    // '/assurance' is now a canonical, capability-gated module route (see the
    // Assurance block below); it is absent here only because ALL_CAPS lacks it.
    for (const banned of ['/portal', '/profile', '/app', '/dashboard/service-requests', '/data-hub/sources', '/assurance', '/verity']) {
      expect(hrefs, banned).not.toContain(banned);
    }
  });
});

describe('active state — exactly one owner, segment aware', () => {
  const sa = resolveNav(ctx('super_admin', ALL_CAPS, 'brainbase-hq'));
  const tennis = resolveNav(ctx('manager', ['events'], 'ld-tennis'));
  it.each([
    ['/dashboard', 'home', sa],
    ['/dashboard/pipeline', 'requests', tennis],
    ['/data-hub/import', 'data-hub', sa],
    ['/data-hub/import/123', 'data-hub', sa],
    ['/data', 'data', sa],
    ['/dashboards', 'ops-all-dashboards', sa],
    ['/dashboard/wste/property/14-edmund-ave', 'ops-waste', sa],
    ['/crm/contacts/1', 'crm', sa],
    ['/admin/founder', 'founder-os', sa],
    ['/admin/pipeline', 'client-requests', sa],
    ['/settings/branding', 'branding', sa],
    ['/account/profile', 'profile', sa],
    ['/dashboard/leads/abc', 'tennis-leads', tennis],
    ['/dashboard/contacts', 'tennis-squad', tennis],
    ['/hlna', 'hlna', tennis],
  ] as const)('%s → %s', (p, id, nav) => {
    expect(activeNavId(nav, p)).toBe(id);
  });

  it('the old collisions are gone: Data Hub never lights Data; Home is exact', () => {
    expect(activeNavId(sa, '/data-hub/import')).not.toBe('data');
    expect(activeNavId(sa, '/dashboard/fleet')).toBe('ops-fleet');
    expect(activeNavId(resolveNav(ctx('viewer', [])), '/dashboard/overview')).toBeNull();
  });

  it('routes with no nav entry are not claimed by a parent', () => {
    expect(activeNavId(sa, '/nope')).toBeNull();
    expect(activeNavId(sa, '/datax')).toBeNull();
    expect(activeNavId(sa, null)).toBeNull();
  });
});

describe('dashboard "Your tools" card derives from the same model', () => {
  it('first-class capability modules only (no Data Hub, Tennis, Manage, Brainbase, Account)', () => {
    expect(workModuleCards(ctx('admin', ALL_CAPS, 'ld-tennis')).map(l => l.id)).toEqual([
      'events', 'crm', 'commercial', 'organiser', 'people',
    ]);
    expect(workModuleCards(ctx('viewer', ALL_CAPS)).map(l => l.id)).toEqual(['events', 'crm', 'commercial', 'people']);
    expect(workModuleCards(ctx('analyst', []))).toEqual([]);
  });
});

describe('role ordering mirrors the server contract', () => {
  it('NAV_ROLE_ORDER equals lib/session.ts ROLE_ORDER and analyst stays outside it', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/session.ts'), 'utf8');
    const m = src.match(/export const ROLE_ORDER: Role\[\] = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const serverOrder = m![1].split(',').map(s => s.trim().replace(/['"]/g, ''));
    expect([...NAV_ROLE_ORDER]).toEqual(serverOrder);
    expect(serverOrder).not.toContain('analyst');
  });

  it('navRoleAtLeast fails closed like roleGte', () => {
    expect(navRoleAtLeast('manager', 'manager')).toBe(true);
    expect(navRoleAtLeast('admin', 'manager')).toBe(true);
    expect(navRoleAtLeast('viewer', 'manager')).toBe(false);
    expect(navRoleAtLeast('analyst', 'viewer')).toBe(false);
    expect(navRoleAtLeast('super_admin', 'super_admin')).toBe(true);
  });
});

describe('Assurance — one generic Work descriptor', () => {
  const allLinks = () => [...WORK_ITEMS, ...BRAINBASE_ITEMS].flatMap(e => (e.kind === 'group' ? e.children : [e]));

  it('exactly one descriptor, of the approved shape, under Work', () => {
    const hits = allLinks().filter(l => l.id === 'assurance' || l.href.startsWith('/assurance') || l.label === 'Assurance');
    expect(hits).toHaveLength(1);
    const a = WORK_ITEMS.find(e => e.id === 'assurance') as NavLink;
    expect(a).toEqual({
      kind: 'link', id: 'assurance', label: 'Assurance', href: '/assurance', match: ['/assurance'],
      icon: 'assurance', card: true, description: 'Incidents, inspections, audits and corrective actions',
      gate: { anyCapability: ['assurance'], minRole: 'viewer' },
    } satisfies NavLink);
    expect(fs.existsSync(path.join(process.cwd(), 'app/assurance/page.tsx'))).toBe(true);
  });

  it('no second route or capability (/verity, verity) exists anywhere in the model', () => {
    const all = allLinks();
    expect(all.some(l => l.href.includes('verity') || l.id.includes('verity'))).toBe(false);
    expect(all.flatMap(l => l.gate?.anyCapability ?? []).filter(k => /assurance|verity/.test(k))).toEqual(['assurance']);
  });

  it('visible only with the capability, for every in-order role and variant; no bypass; analyst fails closed', () => {
    for (const v of [null, 'ld-tennis', 'brainbase-hq'] as const) {
      for (const role of ['viewer', 'manager', 'admin', 'super_admin']) {
        expect(summary(ctx(role, [...ALL_CAPS, 'assurance'], v)).work, `${role}/${v} entitled`).toContain('assurance');
        expect(summary(ctx(role, ALL_CAPS, v)).work, `${role}/${v} not entitled`).not.toContain('assurance');
      }
      expect(summary(ctx('analyst', ['assurance'], v)).work, `analyst/${v}`).not.toContain('assurance');
    }
    expect(isGateOpen(WORK_ITEMS.find(e => e.id === 'assurance')!.gate, ctx('super_admin', []))).toBe(false);
  });

  it('generic client, HQ and LD Tennis all get it from the same Work list (no variant branch)', () => {
    const a = WORK_ITEMS.find(e => e.id === 'assurance')!;
    expect(a.gate?.variant).toBeUndefined();
    expect(a.gate?.hideForVariant).toBeUndefined();
    expect(summary(ctx('viewer', ['assurance'])).work).toEqual(['assurance']);
    expect(summary(ctx('super_admin', ['assurance'], 'brainbase-hq')).work).toContain('assurance');
    expect(summary(ctx('manager', ['assurance'], 'ld-tennis')).work).toEqual(['assurance', 'data-hub', TENNIS]);
    expect(summary(ctx('manager', [], 'ld-tennis')).work).toEqual(['data-hub', TENNIS]);
  });

  it('is a "Your tools" card only when entitled', () => {
    expect(workModuleCards(ctx('viewer', ['assurance'])).map(l => l.id)).toEqual(['assurance']);
    expect(workModuleCards(ctx('viewer', ALL_CAPS)).map(l => l.id)).not.toContain('assurance');
    expect(workModuleCards(ctx('admin', [...ALL_CAPS, 'assurance'], 'ld-tennis')).map(l => l.id)).toEqual([
      'events', 'crm', 'commercial', 'organiser', 'people', 'assurance',
    ]);
  });

  it('owns every Assurance route (Work is active), including Help', () => {
    const nav = resolveNav(ctx('super_admin', [...ALL_CAPS, 'assurance'], 'brainbase-hq'));
    for (const p of [
      '/assurance', '/assurance/incidents', '/assurance/incidents/new', '/assurance/incidents/0b0c',
      '/assurance/investigations', '/assurance/inspections', '/assurance/inspections/templates/x',
      '/assurance/audits', '/assurance/findings', '/assurance/actions', '/assurance/evidence',
      '/assurance/verification', '/assurance/help', '/assurance/help/user-guide', '/assurance/help/perform-verification',
      '/assurance/settings', '/assurance/settings/risk-levels',
    ]) {
      expect(activeNavId(nav, p), p).toBe('assurance');
      expect(containsActive(nav.work, activeNavId(nav, p)), p).toBe(true);
    }
    expect(activeNavId(nav, '/assurancex')).toBeNull();
    expect(activeNavId(nav, '/verity')).toBeNull();
    // Not entitled: the route is simply not claimed by the chrome.
    expect(activeNavId(resolveNav(ctx('viewer', ALL_CAPS)), '/assurance')).toBeNull();
  });

  it('TopNav holds no Assurance-specific code — it only renders the model', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/nav/TopNav.tsx'), 'utf8');
    expect(src).not.toMatch(/assurance|verity/i);
  });
});
