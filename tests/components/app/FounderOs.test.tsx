import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Founder OS (authenticated visual-completion pass) rendered for real
// (jsdom) with every /api/... it calls stubbed with minimal synthetic
// fixtures. Asserts the accessibility contract the convergence added: one
// h1, a labelled nav of real controls with aria-current, keyboard section
// switching, and no axe violations in light or dark. The clients & business
// flow tests also pin organisation-safe navigation (HLNA Labs CRM/Commercial
// records only open in the HLNA Labs workspace, via the existing audited
// /api/admin/impersonate switch) and the removal of the legacy Add lead /
// Book demo / Proposal modals. jsdom only — not a browser check.

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/founder',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

const { default: FounderPage } = await import('@/app/admin/founder/page');

const METRICS = {
  leadsByStage: { new: 2 }, openAlerts: 1, openRequests: 3, onboardingInProgress: 1,
  activeManagedServices: 4, activeMrr: 5400,
  implementationsTotal: 2, implementationsByStage: { build: 1, testing: 1 },
  implementationsAtRisk: 1, implementationsBlocked: 0, implementationsApproachingLaunch: 1,
};
const ATTENTION = {
  items: [{
    id: 'a1', type: 'alert', severity: 'high', title: 'Sync job failing', description: 'Nightly import errored twice.',
    organisationId: 'org-1', organisationName: 'Example Org', createdAt: new Date().toISOString(),
    href: '/admin/orgs', metadata: {},
  }],
  metrics: METRICS,
  implementationNextActions: [{ id: 'i1', organisationName: 'Example Org', name: 'Portal rollout', nextAction: 'Confirm scope', href: '/admin/implementations/i1' }],
};
// Synthetic overview in the GET /api/admin/founder-clients shape
// (lib/founder/clientOverviewTypes.ts). No real client data.
const ALL_OK = {
  organisations: 'ok', capabilities: 'ok', implementations: 'ok', managedServices: 'ok', onboarding: 'ok',
  requests: 'ok', hlnaCrm: 'ok', webLeads: 'ok', hlnaCommercial: 'ok',
};
const CLIENTS = {
  generatedAt: '2026-11-03T00:00:00.000Z',
  hlnaOrganisation: { id: 'hq', name: 'HLNA Labs' },
  hlnaWorkspace: { active: true, switchTo: 'none' },
  sources: ALL_OK,
  registeredOrganisations: [{
    id: 'org-1', name: 'Example Org', slug: 'example-org', status: 'active', plan: 'starter', createdAt: null, userCount: 3,
    capabilities: [{ key: 'crm', name: 'CRM' }],
    implementations: { activeCount: 1, primary: { id: 'impl-1', name: 'Portal rollout', stage: 'build', health: 'on_track', nextAction: 'Confirm scope', targetLaunchDate: null } },
    managedServices: { activeCount: 1, contractedMonthlyCents: '45000', unreadableValueCount: 0 },
    onboarding: null, openRequests: 2,
    links: { workspace: '/clients/org-1', implementation: '/admin/implementations/impl-1', services: '/admin/deployments', requests: '/admin/pipeline' },
  }],
  unlinkedManagedServices: { activeCount: 0, contractedMonthlyCents: '0', unreadableValueCount: 0 },
  prospects: {
    crmCompanies: [{ id: 'co-1', name: 'Sample Shire', openDeals: 1, openDealValue: '12000', openDealsWithoutValue: 0, wonDeals: 0, latestOpenStage: 'proposal', commercialCustomerId: null, href: '/crm/companies/co-1' }],
    crmSummary: { totalCompanies: 1, companiesWithOpenDeals: 1, openDeals: 1, openDealValue: '12000', openDealsWithoutValue: 0, wonDeals: 0 },
    crmPage: { page: 0, pageSize: 200, from: 1, to: 1, totalCompanies: 1, hasPrevious: false, hasNext: false, complete: true },
    webLeadsByStatus: { new: 2 },
  },
  billing: {
    customers: [{ id: 'cu-1', name: 'Example Billing Co', active: true, crmCompanyId: null, issuedInvoiceCount: 1, lastIssueDate: '2026-10-01', amounts: [{ currency: 'AUD', invoicedCents: '110000', allocatedReceivedCents: '50000', outstandingCents: '60000', partPaidInvoiceCount: 1 }], unreadableAmountRows: 0, relationship: 'paying', href: '/commercial/customers/cu-1' }],
    totals: [{ currency: 'AUD', invoicedCents: '110000', allocatedReceivedCents: '50000', outstandingCents: '60000', partPaidInvoiceCount: 1 }],
    unreadableAmountRows: 0,
  },
  notConnected: [{ key: 'eve', label: 'Eve ticketing', note: 'Not read here.' }],
};
let clientsResponse: { body: unknown; status: number };
// Optional per-URL responder for founder-clients (CRM paging tests).
let clientsHandler: ((url: string) => Promise<Response>) | null;
const SYSTEM = {
  application: { environment: 'preview', commitSha: 'abc1234def', commitShaShort: 'abc1234', commitMessage: 'fix: tidy' },
  database: { ok: true, latencyMs: 12 },
  services: {
    gmail: { state: 'connected' }, googleCalendar: { state: 'not_connected' },
    instagram: { state: 'connected_issue' }, microsoft365: { state: 'unknown' },
  },
};
const TASKS = {
  board: { id: 'b1', name: 'Founder Tasks' },
  groups: {
    overdue: [{ id: 't1', title: 'Renew certificate', status: 'Working on it', priority: 'High', owner: null, dueDate: '2026-09-01', notes: null, createdAt: '2026-09-01', updatedAt: '2026-09-01' }],
    today: [], upcoming: [], noDueDate: [], completed: [],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;
let impersonateResponse: { status: number; body: unknown };
let opsAlerts: unknown[];
const originalLocation = window.location;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  push.mockReset();
  clientsResponse = { body: CLIENTS, status: 200 };
  clientsHandler = null;
  impersonateResponse = { status: 200, body: { ok: true } };
  opsAlerts = [];
  assign = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...originalLocation, assign }, writable: true, configurable: true });
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const json = (b: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } }));
    if (url === '/api/admin/founder-clients' || url.startsWith('/api/admin/founder-clients?')) {
      if (clientsHandler) return clientsHandler(url);
      return json(clientsResponse.body, clientsResponse.status);
    }
    if (url === '/api/admin/impersonate') return json(impersonateResponse.body, impersonateResponse.status);
    if (url === '/api/founder/attention-queue') return json(ATTENTION);
    if (url === '/api/ops/alerts') return json({ alerts: opsAlerts });
    if (url === '/api/founder/tasks') return json(TASKS);
    if (url === '/api/founder/system') return json(SYSTEM);
    if (url === '/api/founder/usage') return json({ windowDays: 30, uploads: 7, organiserUpdates: 3 });
    if (url === '/api/integrations/microsoft/events') return json({ events: [] });
    if (url === '/api/implementations') return json({ implementations: [] });
    if (url === '/api/instagram/feed') return json({ connected: false });
    if (url === '/api/admin/orgs') return json({ orgs: [] });
    if (url === '/api/admin/users') return json({ users: [] });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
});

async function renderFounder(theme: 'light' | 'dark' = 'dark') {
  const utils = renderBrainbase(<FounderPage />, { theme });
  await screen.findAllByRole('heading', { name: 'Clients & business flow' });
  await screen.findByText('Sync job failing');
  await screen.findAllByText('Service connections');
  return utils;
}

describe.each(['light', 'dark'] as const)('Founder OS (%s)', theme => {
  it('renders the key sections with one h1 and no axe violations', async () => {
    const { container } = await renderFounder(theme);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('BRAINBASE FOUNDER OS');
    for (const name of ['Attention queue', 'Real operational snapshot', 'Client implementations', 'Clients & business flow', 'Founder tasks', 'System status']) {
      expect(screen.getAllByRole('heading', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('complementary', { name: 'Founder context' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('passes axe with the HLNA actions disabled and explained (overview unavailable)', async () => {
    clientsResponse = { status: 500, body: { error: 'boom' } };
    const { container } = renderBrainbase(<FounderPage />, { theme });
    await screen.findByText('Client overview unavailable');
    expect(screen.getByRole('button', { name: 'Add lead (CRM deal)' })).toBeDisabled();
    await expectNoAxeViolations(container);
  });
});

describe('Founder OS navigation', () => {
  it('is a labelled nav of real buttons/links; the current section carries aria-current and switching works from the keyboard', async () => {
    const { user } = await renderFounder();
    const nav = screen.getByRole('navigation', { name: 'Founder OS' });
    const overview = within(nav).getByRole('button', { name: 'Overview' });
    const clients = within(nav).getByRole('button', { name: 'Clients' });
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(clients).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Organiser' })).toHaveAttribute('href', '/organiser');
    expect(within(nav).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');

    clients.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(clients).toHaveAttribute('aria-current', 'page'));
    expect(overview).not.toHaveAttribute('aria-current');
    expect(fetchMock).toHaveBeenCalledWith('/api/implementations');
    // The section switch mirrors the same state with aria-pressed.
    const view = screen.getByRole('group', { name: 'Founder OS view' });
    expect(within(view).getByRole('button', { name: 'Clients' })).toHaveAttribute('aria-pressed', 'true');
  });
});

const workspace = (switchTo: string) => ({ ...CLIENTS, hlnaWorkspace: { active: switchTo === 'none', switchTo } });
const fetchedUrls = () => fetchMock.mock.calls.map(c => String(c[0]));

describe('Founder OS — lead, demo and proposal actions', () => {
  it('the legacy modals are gone: no dialog opens and no founder-action backend is called', async () => {
    const { user } = await renderFounder();
    for (const name of ['Add lead', 'Book demo', 'Gen proposal']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    await user.click(screen.getByRole('button', { name: 'Add lead (CRM deal)' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchedUrls().some(u => u.includes('founder-action'))).toBe(false);
  });

  it.each([
    ['Add lead (CRM deal)', '/crm/deals'],
    ['Log demo (CRM activity)', '/crm/activities'],
    ['New quote (Commercial)', '/commercial/quotes/new'],
  ])('in the HLNA Labs workspace, "%s" opens %s directly', async (name, href) => {
    const { user } = await renderFounder();
    await user.click(screen.getByRole('button', { name }));
    expect(assign).toHaveBeenCalledWith(href);
    expect(fetchedUrls()).not.toContain('/api/admin/impersonate');
  });

  it('while working in another organisation, an action first switches to HLNA Labs through the audited flow, then opens', async () => {
    clientsResponse = { status: 200, body: workspace('view_as_hlna') };
    const { user } = await renderFounder();
    const action = screen.getByRole('button', { name: 'Add lead (CRM deal)' });
    expect(action).toHaveAccessibleDescription(/switches your working organisation first/);
    await user.click(action);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/crm/deals'));
    const call = fetchMock.mock.calls.find(c => String(c[0]) === '/api/admin/impersonate')!;
    expect(call[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ orgId: 'hq' }) });
  });

  it('when the overview cannot confirm the workspace, the actions are disabled with a reason', async () => {
    clientsResponse = { status: 500, body: { error: 'boom' } };
    renderBrainbase(<FounderPage />);
    await screen.findByText('Client overview unavailable');
    for (const name of ['Add lead (CRM deal)', 'Log demo (CRM activity)', 'New quote (Commercial)']) {
      const b = screen.getByRole('button', { name });
      expect(b).toBeDisabled();
      expect(b).toHaveAccessibleDescription(/could not be confirmed/);
    }
  });

  it('the Clients-tab attention queue opens Command Centre instead of a fake "Done"', async () => {
    opsAlerts = [{ id: 'al-1', severity: 'high', title: 'Synthetic lead alert', description: 'Synthetic.', rule_key: null, created_at: '2026-11-01T00:00:00Z', status: 'OPEN' }];
    await openClientsTab();
    const link = await screen.findByRole('link', { name: '→ Review in Command Centre' });
    expect(link).toHaveAttribute('href', '/command');
    expect(screen.queryByText('✓ Done')).toBeNull();
  });
});

async function openClientsTab() {
  const utils = await renderFounder();
  const nav = screen.getByRole('navigation', { name: 'Founder OS' });
  await utils.user.click(within(nav).getByRole('button', { name: 'Clients' }));
  await screen.findByRole('heading', { name: 'Registered organisations' });
  return utils;
}

describe('Founder OS — clients & business flow', () => {
  it('shows registered organisations, prospects and billing separately, with links to the existing screens (working in HLNA Labs)', async () => {
    const { container } = await openClientsTab();
    expect(screen.getByRole('link', { name: 'Example Org' })).toHaveAttribute('href', '/clients/org-1');
    expect(screen.getByRole('link', { name: 'Implementation →' })).toHaveAttribute('href', '/admin/implementations/impl-1');
    expect(screen.getByRole('link', { name: 'Services →' })).toHaveAttribute('href', '/admin/deployments');
    expect(screen.getByRole('link', { name: 'Requests →' })).toHaveAttribute('href', '/admin/pipeline');
    expect(screen.getByRole('link', { name: 'Sample Shire' })).toHaveAttribute('href', '/crm/companies/co-1');
    expect(screen.getByRole('link', { name: 'Example Billing Co' })).toHaveAttribute('href', '/commercial/customers/cu-1');
    expect(screen.getAllByRole('link', { name: 'Founder tasks →' })[0]).toHaveAttribute('href', '/organiser');
    // Estimates and contracted values are labelled, never presented as revenue.
    expect(screen.getByText(/\$450\.00\/mo contracted \(not invoiced\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/\$12,000 estimate/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Payment allocated · invoiced \$1,100\.00 · received \$500\.00 · outstanding \$600\.00/)).toBeInTheDocument();
    expect(screen.getByText('Received (allocated to issued invoices)')).toBeInTheDocument();
    // No "switch organisation" notice when already in HLNA Labs.
    expect(screen.queryByText(/You are working in another organisation/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Not connected yet' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('exact amounts above Number.MAX_SAFE_INTEGER render digit-for-digit; unreadable ledger rows are reported, not zeroed', async () => {
    const big = { currency: 'AUD', invoicedCents: '18014398509481986', allocatedReceivedCents: '9007199254740993', outstandingCents: '9007199254740993', partPaidInvoiceCount: 0 };
    clientsResponse = { status: 200, body: { ...CLIENTS, billing: { ...CLIENTS.billing, totals: [big], unreadableAmountRows: 2 } } };
    await openClientsTab();
    expect(screen.getAllByText('$180,143,985,094,819.86').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$90,071,992,547,409.93').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 ledger rows had an unreadable amount or currency and are not included in these totals/)).toBeInTheDocument();
    expect(screen.getAllByText(/incomplete: 2 unreadable/).length).toBeGreaterThan(0);
  });

  it('a capped CRM page says it is one page of the portfolio and pages through the bounded API', async () => {
    const companies = Array.from({ length: 200 }, (_, i) => ({ id: `co-${i}`, name: `Synthetic Co ${i}`, openDeals: 0, openDealValue: '0', openDealsWithoutValue: 0, wonDeals: 0, latestOpenStage: null, commercialCustomerId: null, href: `/crm/companies/co-${i}` }));
    clientsResponse = { status: 200, body: { ...CLIENTS, prospects: {
      ...CLIENTS.prospects,
      crmCompanies: companies,
      crmSummary: { totalCompanies: 523, companiesWithOpenDeals: 40, openDeals: 57, openDealValue: '98765.5', openDealsWithoutValue: 3, invalidOpenDealValues: 2, wonDeals: 9 },
      crmPage: { page: 0, pageSize: 200, from: 1, to: 200, totalCompanies: 523, hasPrevious: false, hasNext: true, complete: false },
    } } };
    const { user } = await openClientsTab();
    expect(screen.getByText('Showing companies 1–200 of 523. This list is one page, not the whole portfolio.')).toBeInTheDocument();
    expect(screen.getByText(/All 523 companies: 40 with open deals · 57 open deals · \$98,765\.50 estimate \(3 open deals with no value; 2 invalid values excluded; not included\) · 9 won/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/founder-clients?crmPage=1'));
  });

  it('an unavailable source is reported as unavailable, never as an empty list', async () => {
    clientsResponse = {
      status: 200,
      body: { ...CLIENTS, sources: { ...ALL_OK, hlnaCommercial: 'unavailable' }, billing: { customers: null, totals: null } },
    };
    await openClientsTab();
    expect(screen.getByText('HLNA Labs Commercial ledger unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No Commercial customers yet')).toBeNull();
    expect(screen.getAllByRole('status').some(n => /HLNA Commercial ledger/.test(n.textContent ?? ''))).toBe(true);
  });

  it('a genuinely empty organisation list says so', async () => {
    clientsResponse = { status: 200, body: { ...CLIENTS, registeredOrganisations: [] } };
    await openClientsTab();
    expect(screen.getByText('No client organisations registered')).toBeInTheDocument();
  });

  it('a failed overview request shows an unavailable state, not zeros', async () => {
    clientsResponse = { status: 500, body: { error: 'boom' } };
    await renderFounder();
    expect(await screen.findByText('Client overview unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Registered organisations')).toBeNull();
  });
});

describe('Founder OS — HLNA Labs records while impersonating another organisation', () => {
  it('CRM/Commercial records are not plain links; the notice explains the switch', async () => {
    clientsResponse = { status: 200, body: workspace('stop_viewing_as') };
    await openClientsTab();
    expect(screen.queryByRole('link', { name: 'Sample Shire' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Example Billing Co' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('You are working in another organisation. These records belong to HLNA Labs');
    const company = screen.getByRole('button', { name: 'Sample Shire' });
    expect(company).toHaveAccessibleDescription(/switches your working organisation to HLNA Labs/);
    // Organisation-level admin screens are cross-organisation for super_admin and stay plain links.
    expect(screen.getByRole('link', { name: 'Example Org' })).toHaveAttribute('href', '/clients/org-1');
  });

  it('HLNA Labs is home: opening a record clears the override (DELETE) before navigating', async () => {
    clientsResponse = { status: 200, body: workspace('stop_viewing_as') };
    const { user } = await openClientsTab();
    await user.click(screen.getByRole('button', { name: 'Sample Shire' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/crm/companies/co-1'));
    const calls = fetchMock.mock.calls.filter(c => String(c[0]) === '/api/admin/impersonate');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('HLNA Labs is not home: switches with POST { orgId: <server-resolved HQ id> } before navigating', async () => {
    clientsResponse = { status: 200, body: workspace('view_as_hlna') };
    const { user } = await openClientsTab();
    await user.click(screen.getByRole('button', { name: 'Example Billing Co' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/commercial/customers/cu-1'));
    const call = fetchMock.mock.calls.find(c => String(c[0]) === '/api/admin/impersonate')!;
    expect(call[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ orgId: 'hq' }) });
  });

  it('a refused switch opens nothing and says so', async () => {
    clientsResponse = { status: 200, body: workspace('view_as_hlna') };
    impersonateResponse = { status: 403, body: { error: 'Forbidden' } };
    const { user } = await openClientsTab();
    await user.click(screen.getByRole('button', { name: 'Sample Shire' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch to HLNA Labs (403). Nothing was opened.');
    expect(assign).not.toHaveBeenCalled();
  });

  it('with no HLNA Labs organisation, record controls are disabled with the reason', async () => {
    clientsResponse = { status: 200, body: workspace('unavailable') };
    await openClientsTab();
    const company = screen.getByRole('button', { name: 'Sample Shire' });
    expect(company).toBeDisabled();
    expect(company).toHaveAccessibleDescription(/No HLNA Labs organisation was found/);
    expect(screen.getByRole('button', { name: 'Add lead (CRM deal)' })).toBeDisabled();
  });

  it('passes axe while impersonating', async () => {
    clientsResponse = { status: 200, body: workspace('view_as_hlna') };
    const { container } = await openClientsTab();
    await expectNoAxeViolations(container);
  });
});

// ── CRM paging: requested page vs displayed page ─────────────────────────────
const TOTAL = 523;
function crmPageBody(page: number) {
  const from = page * 200 + 1;
  const to = Math.min((page + 1) * 200, TOTAL);
  return {
    ...CLIENTS,
    prospects: {
      ...CLIENTS.prospects,
      crmCompanies: [0, 1].map(i => ({ id: `p${page}-${i}`, name: `Page${page} Co ${i}`, openDeals: 0, openDealValue: '0', openDealsWithoutValue: 0, invalidOpenDealValues: 0, wonDeals: 0, latestOpenStage: null, commercialCustomerId: null, href: `/crm/companies/p${page}-${i}` })),
      crmSummary: { totalCompanies: TOTAL, companiesWithOpenDeals: 0, openDeals: 0, openDealValue: '0', openDealsWithoutValue: 0, invalidOpenDealValues: 0, wonDeals: 0 },
      crmPage: { page, pageSize: 200, from, to, totalCompanies: TOTAL, hasPrevious: page > 0, hasNext: to < TOTAL, complete: false },
    },
  };
}
const ok = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
const fail = () => Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
const pageOf = (url: string) => Number(new URL(url, 'http://x').searchParams.get('crmPage') ?? '0');
function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve: (b: unknown) => resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })) };
}
const shows = (page: number) => screen.queryByText(`Page${page} Co 0`) !== null;

describe('Founder OS — CRM paging retries and ordering', () => {
  it('Next fails, the last good page stays, and Next again refetches and succeeds', async () => {
    let page1Calls = 0;
    clientsHandler = url => {
      const p = pageOf(url);
      if (p === 1 && ++page1Calls === 1) return fail();
      return ok(crmPageBody(p));
    };
    const { user } = await openClientsTab();
    expect(shows(0)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    expect(await screen.findByText('Could not load page 2; still showing companies 1–200.')).toBeInTheDocument();
    expect(shows(0)).toBe(true);
    expect(screen.queryByText(/Loading page/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    await waitFor(() => expect(shows(1)).toBe(true));
    expect(page1Calls).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Showing companies 201–400 of 523. This list is one page, not the whole portfolio.')).toBeInTheDocument();
  });

  it('Previous fails, then "Retry" refetches the same page and succeeds', async () => {
    let page0Calls = 0;
    clientsHandler = url => {
      const p = pageOf(url);
      if (p === 0 && ++page0Calls === 2) return fail(); // the Previous request
      return ok(crmPageBody(p));
    };
    const { user } = await openClientsTab();
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    await waitFor(() => expect(shows(1)).toBe(true));
    await user.click(screen.getByRole('button', { name: '← Previous' }));
    expect(await screen.findByText('Could not load page 1; still showing companies 201–400.')).toBeInTheDocument();
    expect(shows(1)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Retry page 1' }));
    await waitFor(() => expect(shows(0)).toBe(true));
    expect(page0Calls).toBe(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an older response cannot replace a newer page', async () => {
    const pending: Record<number, ReturnType<typeof deferred>> = {};
    let gate = false;
    clientsHandler = url => {
      const p = pageOf(url);
      if (!gate) return ok(crmPageBody(p));
      pending[p] = deferred();
      return pending[p].promise;
    };
    const { user } = await openClientsTab();
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    await waitFor(() => expect(shows(1)).toBe(true));
    gate = true;
    await user.click(screen.getByRole('button', { name: 'Next →' }));      // older: page 3 (index 2)
    await user.click(screen.getByRole('button', { name: '← Previous' }));  // newer: page 1 (index 0)
    expect(screen.getByText('Loading page 1…')).toBeInTheDocument();
    pending[0].resolve(crmPageBody(0));
    await waitFor(() => expect(shows(0)).toBe(true));
    pending[2].resolve(crmPageBody(2));
    await new Promise(r => setTimeout(r, 20));
    expect(shows(0)).toBe(true);
    expect(shows(2)).toBe(false);
    expect(screen.queryByText(/Loading page/)).toBeNull();
  });
});
