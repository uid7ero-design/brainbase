// Authenticated navigation model — the single source of truth for WHAT the
// signed-in chrome offers and WHO sees it. Pure data + pure functions: no
// React, no DOM, no server-only imports, so the same model drives TopNav
// (desktop menus and the mobile menu) and the dashboard "Your tools" card.
//
// This is a visibility model, never an authorization boundary. Every route
// keeps its own server-side guard (layouts, pages, API routes); a descriptor
// here only decides whether a link is offered. Gates therefore MIRROR the
// route contracts they point at (e.g. Organiser: capability + manager+,
// matching app/organiser/layout.tsx) so the chrome never offers a link the
// route will reject.
//
// Adding a module is one descriptor in WORK_ITEMS and needs no rendering
// change — Assurance (below) was added exactly that way.

export type DashboardVariant = 'ld-tennis' | 'brainbase-hq' | null;

/** Everything visibility may depend on. `role` is the REAL signed-in role:
 *  an impersonating super_admin keeps role 'super_admin' while
 *  `enabledCapabilities` / `dashboardVariant` describe the organisation being
 *  viewed (see lib/org.ts requireSession and app/layout.tsx). */
export type NavContext = {
  role: string;
  enabledCapabilities: readonly string[];
  dashboardVariant: DashboardVariant;
};

/** Mirrors lib/session.ts ROLE_ORDER (that module is server-only, so it
 *  cannot be imported into client chrome). Any role outside this list —
 *  including 'analyst' — fails every minimum-role check (fail closed), the
 *  same semantics as lib/session.ts roleGte. Pinned by a test against the
 *  server copy so the two cannot drift. */
export const NAV_ROLE_ORDER = ['viewer', 'manager', 'admin', 'super_admin'] as const;
export type NavMinRole = (typeof NAV_ROLE_ORDER)[number];

export function navRoleAtLeast(role: string, min: NavMinRole): boolean {
  const roleIdx = (NAV_ROLE_ORDER as readonly string[]).indexOf(role);
  const minIdx = NAV_ROLE_ORDER.indexOf(min);
  if (roleIdx === -1 || minIdx === -1) return false;
  return roleIdx >= minIdx;
}

export type NavGate = {
  /** Minimum real role (fail closed for unknown roles). */
  minRole?: NavMinRole;
  /** Visible when ANY of these capabilities is enabled for the viewed org. */
  anyCapability?: readonly string[];
  /** Roles that pass `anyCapability` without it (People: super_admin,
   *  mirroring lib/hr/capability.ts). */
  capabilityBypassRoles?: readonly string[];
  /** Tenant-area predicate: visible only for this dashboard variant. */
  variant?: Exclude<DashboardVariant, null>;
  /** Hidden for this dashboard variant (Requests is hidden for Brainbase HQ,
   *  as before). */
  hideForVariant?: Exclude<DashboardVariant, null>;
  /** Brainbase-internal: visible only to a REAL super_admin, regardless of
   *  the viewed organisation or its variant. */
  internal?: boolean;
};

export type NavLink = {
  kind: 'link';
  id: string;
  label: string;
  href: string;
  /** Route sections this link owns for active-state purposes. Matching is
   *  segment-aware ('/data' never matches '/data-hub') and the single
   *  longest match wins across the whole tree (see activeNavId). */
  match: readonly string[];
  /** Match the section exactly (no descendants) — Home owns '/dashboard'
   *  itself, not every '/dashboard/*' route. */
  exact?: boolean;
  description?: string;
  /** CapabilityIcon key for module entries. */
  icon?: string;
  /** Show as a first-class module in the dashboard "Your tools" card. */
  card?: boolean;
  gate?: NavGate;
};

export type NavGroup = {
  kind: 'group';
  id: string;
  label: string;
  gate?: NavGate;
  children: readonly NavLink[];
};

export type NavEntry = NavLink | NavGroup;

// ─── Descriptors ────────────────────────────────────────────────────────────

export const HOME_LINK: NavLink = {
  kind: 'link', id: 'home', label: 'Home', href: '/dashboard', match: ['/dashboard'], exact: true,
};

export const HLNA_LINK: NavLink = {
  kind: 'link', id: 'hlna', label: 'HLNA', href: '/hlna', match: ['/hlna'],
};

export const WORK_ITEMS: readonly NavEntry[] = [
  {
    kind: 'link', id: 'events', label: 'Events & Ticketing', href: '/events', match: ['/events'],
    icon: 'events', card: true, description: 'Events, registrations and tickets',
    gate: { anyCapability: ['events'] },
  },
  {
    kind: 'link', id: 'crm', label: 'CRM', href: '/crm', match: ['/crm'],
    icon: 'crm', card: true, description: 'Companies, contacts, deals and activities',
    gate: { anyCapability: ['crm'] },
  },
  {
    kind: 'link', id: 'commercial', label: 'Commercial', href: '/commercial', match: ['/commercial'],
    icon: 'quotes', card: true, description: 'Quotes, invoices and purchasing',
    // app/commercial/layout.tsx admits ANY of the three.
    gate: { anyCapability: ['quotes', 'invoicing', 'purchasing'] },
  },
  {
    kind: 'link', id: 'organiser', label: 'Organiser', href: '/organiser', match: ['/organiser'],
    icon: 'organiser', card: true, description: 'Boards and tasks for your organisation',
    // app/organiser/layout.tsx requires the capability AND manager+.
    gate: { anyCapability: ['organiser'], minRole: 'manager' },
  },
  {
    kind: 'link', id: 'people', label: 'People', href: '/people', match: ['/people'],
    icon: 'people', card: true, description: 'People, teams and HR records',
    // lib/hr/capability.ts: super_admin bypasses the People capability.
    gate: { anyCapability: ['people'], capabilityBypassRoles: ['super_admin'] },
  },
  {
    kind: 'link', id: 'assurance', label: 'Assurance', href: '/assurance', match: ['/assurance'],
    icon: 'assurance', card: true, description: 'Incidents, inspections, audits and corrective actions',
    // lib/assurance/authorize.ts: the 'assurance' capability AND viewer+
    // (roles outside the order, e.g. analyst, are refused); no role bypass.
    gate: { anyCapability: ['assurance'], minRole: 'viewer' },
  },
  {
    kind: 'link', id: 'data-hub', label: 'Data Hub', href: '/data-hub/import', match: ['/data-hub'],
    description: 'Import governed datasets',
    // app/data-hub/import/page.tsx: requireRole('manager').
    gate: { minRole: 'manager' },
  },
  {
    kind: 'group', id: 'tennis', label: 'Tennis',
    // Tenant-specific work area. Same slug-driven predicate the dashboard
    // routing uses (lib/dashboard/clientDashboard.ts); not a capability.
    gate: { variant: 'ld-tennis' },
    children: [
      { kind: 'link', id: 'tennis-leads', label: 'Leads', href: '/dashboard/leads', match: ['/dashboard/leads'] },
      { kind: 'link', id: 'tennis-squad', label: 'Squad', href: '/dashboard/contacts', match: ['/dashboard/contacts'] },
      { kind: 'link', id: 'tennis-sessions', label: 'Sessions', href: '/dashboard/sessions', match: ['/dashboard/sessions'] },
      { kind: 'link', id: 'tennis-blog', label: 'Blog', href: '/dashboard/blog', match: ['/dashboard/blog'] },
    ],
  },
];

export const REQUESTS_LINK: NavLink = {
  kind: 'link', id: 'requests', label: 'Requests', href: '/dashboard/pipeline', match: ['/dashboard/pipeline'],
  gate: { hideForVariant: 'brainbase-hq' },
};

export const MANAGE_ITEMS: readonly NavEntry[] = [
  {
    kind: 'link', id: 'integrations', label: 'Integrations', href: '/dashboard/integrations',
    match: ['/dashboard/integrations'], description: 'Connected data sources',
    // Existing mutation floor on /api/integrations is manager+.
    gate: { minRole: 'manager' },
  },
  {
    kind: 'link', id: 'branding', label: 'Branding', href: '/settings/branding',
    match: ['/settings/branding'], description: 'Logo, colours and contact details',
    // app/settings/branding/page.tsx: requireRole('admin').
    gate: { minRole: 'admin' },
  },
];

const INTERNAL: NavGate = { internal: true };

export const BRAINBASE_ITEMS: readonly NavEntry[] = [
  { kind: 'link', id: 'founder-os', label: 'Founder OS', href: '/admin/founder', match: ['/admin/founder'], gate: INTERNAL },
  { kind: 'link', id: 'command', label: 'Command', href: '/command', match: ['/command'], gate: INTERNAL },
  { kind: 'link', id: 'clients', label: 'Clients', href: '/clients', match: ['/clients'], gate: INTERNAL },
  { kind: 'link', id: 'client-requests', label: 'Client requests', href: '/admin/pipeline', match: ['/admin/pipeline'], gate: INTERNAL },
  {
    kind: 'group', id: 'operations', label: 'Operations', gate: INTERNAL,
    children: [
      { kind: 'link', id: 'ops-waste', label: 'Waste', href: '/dashboard/wste', match: ['/dashboard/wste'], gate: INTERNAL },
      { kind: 'link', id: 'ops-fleet', label: 'Fleet', href: '/dashboard/fleet', match: ['/dashboard/fleet'], gate: INTERNAL },
      { kind: 'link', id: 'ops-social', label: 'Social', href: '/dashboard/social', match: ['/dashboard/social'], gate: INTERNAL },
      { kind: 'link', id: 'ops-all-dashboards', label: 'All dashboards', href: '/dashboards', match: ['/dashboards'], gate: INTERNAL },
    ],
  },
  {
    kind: 'group', id: 'data-reports', label: 'Data & reports', gate: INTERNAL,
    children: [
      { kind: 'link', id: 'data', label: 'Data', href: '/data', match: ['/data'], gate: INTERNAL },
      { kind: 'link', id: 'reports', label: 'Reports', href: '/reports', match: ['/reports'], gate: INTERNAL },
    ],
  },
  {
    kind: 'group', id: 'platform', label: 'Platform', gate: INTERNAL,
    children: [
      { kind: 'link', id: 'platform-orgs', label: 'Organisations', href: '/admin/orgs', match: ['/admin/orgs'], gate: INTERNAL },
      { kind: 'link', id: 'platform-users', label: 'Users', href: '/admin/users', match: ['/admin/users'], gate: INTERNAL },
      { kind: 'link', id: 'platform-client-events', label: 'Client Events', href: '/admin/client-events', match: ['/admin/client-events'], gate: INTERNAL },
      { kind: 'link', id: 'platform-setup', label: 'Setup', href: '/onboarding', match: ['/onboarding'], gate: INTERNAL },
    ],
  },
];

export const ACCOUNT_PROFILE_LINK: NavLink = {
  kind: 'link', id: 'profile', label: 'My profile', href: '/account/profile', match: ['/account/profile'],
};

// ─── Visibility ─────────────────────────────────────────────────────────────

export function isGateOpen(gate: NavGate | undefined, ctx: NavContext): boolean {
  if (!gate) return true;
  if (gate.internal && ctx.role !== 'super_admin') return false;
  if (gate.minRole && !navRoleAtLeast(ctx.role, gate.minRole)) return false;
  if (gate.variant && ctx.dashboardVariant !== gate.variant) return false;
  if (gate.hideForVariant && ctx.dashboardVariant === gate.hideForVariant) return false;
  if (gate.anyCapability) {
    const bypass = gate.capabilityBypassRoles?.includes(ctx.role) ?? false;
    const enabled = gate.anyCapability.some(key => ctx.enabledCapabilities.includes(key));
    if (!bypass && !enabled) return false;
  }
  return true;
}

function visibleEntries(entries: readonly NavEntry[], ctx: NavContext): NavEntry[] {
  const out: NavEntry[] = [];
  for (const entry of entries) {
    if (!isGateOpen(entry.gate, ctx)) continue;
    if (entry.kind === 'group') {
      const children = entry.children.filter(child => isGateOpen(child.gate, ctx));
      if (children.length > 0) out.push({ ...entry, children });
    } else {
      out.push(entry);
    }
  }
  return out;
}

export type ResolvedNav = {
  home: NavLink;
  hlna: NavLink;
  /** Empty = no Work trigger. */
  work: NavEntry[];
  requests: NavLink | null;
  /** Empty = no Manage trigger. */
  manage: NavEntry[];
  /** Empty = no Brainbase trigger (non-super_admin). */
  brainbase: NavEntry[];
  account: { profile: NavLink };
};

export function resolveNav(ctx: NavContext): ResolvedNav {
  return {
    home: HOME_LINK,
    hlna: HLNA_LINK,
    work: visibleEntries(WORK_ITEMS, ctx),
    requests: isGateOpen(REQUESTS_LINK.gate, ctx) ? REQUESTS_LINK : null,
    manage: visibleEntries(MANAGE_ITEMS, ctx),
    brainbase: visibleEntries(BRAINBASE_ITEMS, ctx),
    account: { profile: ACCOUNT_PROFILE_LINK },
  };
}

/** First-class Work modules for the dashboard "Your tools" card: visible
 *  Work links flagged `card` (never groups, internal, Manage or Account). */
export function workModuleCards(ctx: NavContext): NavLink[] {
  return visibleEntries(WORK_ITEMS, ctx).filter(
    (entry): entry is NavLink => entry.kind === 'link' && entry.card === true,
  );
}

// ─── Active state ───────────────────────────────────────────────────────────

/** Length of the section of `link` that `pathname` falls in, or -1. Segment
 *  aware: '/data' matches '/data' and '/data/x' but never '/data-hub'. */
export function navMatchLength(pathname: string, link: NavLink): number {
  let best = -1;
  for (const section of link.match) {
    const hit = link.exact
      ? pathname === section
      : pathname === section || pathname.startsWith(section + '/');
    if (hit && section.length > best) best = section.length;
  }
  return best;
}

export function flattenNavLinks(nav: ResolvedNav): NavLink[] {
  const links: NavLink[] = [nav.home, nav.hlna];
  const walk = (entries: readonly NavEntry[]) => {
    for (const e of entries) {
      if (e.kind === 'group') links.push(...e.children);
      else links.push(e);
    }
  };
  walk(nav.work);
  if (nav.requests) links.push(nav.requests);
  walk(nav.manage);
  walk(nav.brainbase);
  links.push(nav.account.profile);
  return links;
}

/** The ONE visible link that owns `pathname` (longest section wins), so two
 *  destinations can never both read as current. */
export function activeNavId(nav: ResolvedNav, pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  let bestId: string | null = null;
  let bestLen = -1;
  for (const link of flattenNavLinks(nav)) {
    const len = navMatchLength(pathname, link);
    if (len > bestLen) {
      bestLen = len;
      bestId = link.id;
    }
  }
  return bestId;
}

/** True when a group (or menu entry list) contains the active link. */
export function containsActive(entries: readonly NavEntry[], activeId: string | null): boolean {
  if (!activeId) return false;
  return entries.some(e =>
    e.kind === 'group' ? e.children.some(c => c.id === activeId) : e.id === activeId,
  );
}
