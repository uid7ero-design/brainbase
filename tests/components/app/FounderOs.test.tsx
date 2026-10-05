import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Founder OS (authenticated visual-completion pass) rendered for real
// (jsdom) with every /api/... it calls stubbed with minimal synthetic
// fixtures. Asserts the accessibility contract the convergence added: one
// h1, a labelled nav of real controls with aria-current, keyboard section
// switching, dialog semantics (Escape + focus return) for the modals and
// the client drawer, and no axe violations in light or dark. Data
// authority / trust-boundary rules are pinned by the founder* containment
// tests, not re-tested here.

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
const CLIENTS = {
  clients: [
    { id: 1, organisation_name: 'Example Org', contact_name: 'Sam Lee', stage: 'demo', estimated_value: 2400, last_contacted_at: null, next_action: 'Send deck' },
    { id: 2, organisation_name: 'Sample Shire', contact_name: 'Kim Park', stage: 'trial', estimated_value: 1200, last_contacted_at: null, next_action: 'Check usage' },
  ],
};
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
beforeEach(() => {
  push.mockReset();
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const json = (b: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } }));
    if (url === '/api/admin/founder-clients') return json(CLIENTS);
    if (url === '/api/founder/attention-queue') return json(ATTENTION);
    if (url === '/api/ops/alerts') return json({ alerts: [] });
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

async function renderFounder(theme: 'light' | 'dark' = 'dark') {
  const utils = renderBrainbase(<FounderPage />, { theme });
  await screen.findByRole('button', { name: 'Example Org' });
  await screen.findByText('Sync job failing');
  await screen.findAllByText('Service connections');
  return utils;
}

describe.each(['light', 'dark'] as const)('Founder OS (%s)', theme => {
  it('renders the key sections with one h1 and no axe violations', async () => {
    const { container } = await renderFounder(theme);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('BRAINBASE FOUNDER OS');
    for (const name of ['Attention queue', 'Real operational snapshot', 'Client implementations', 'Client pipeline', 'Founder tasks', 'System status']) {
      expect(screen.getAllByRole('heading', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('complementary', { name: 'Founder context' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('opens the Add Lead dialog and passes axe with it open', async () => {
    const { container, user } = await renderFounder(theme);
    await user.click(screen.getByRole('button', { name: 'Add lead' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Lead' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('Contact name')).toBeInTheDocument();
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

describe('Founder OS dialogs', () => {
  it('Book Demo: opens as a named modal dialog, Escape closes it and focus returns to the opener', async () => {
    const { user } = await renderFounder();
    const opener = screen.getByRole('button', { name: 'Book demo' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Book Demo' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('Client')).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Confirm Demo' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('pipeline rows open the client drawer as a dialog from the keyboard; Escape closes it', async () => {
    const { user } = await renderFounder();
    const row = screen.getByRole('button', { name: 'Example Org' });
    row.focus();
    await user.keyboard('{Enter}');
    const drawer = screen.getByRole('dialog', { name: 'Example Org' });
    expect(within(drawer).getByRole('button', { name: 'Close Example Org' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '← Back' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row).toHaveFocus();
  });

  it('the row Follow up action calls the follow-up endpoint directly (the old no-op Btn wrapper is gone)', async () => {
    const { user } = await renderFounder();
    await user.click(screen.getByRole('button', { name: 'Follow up Example Org' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/founder-action/follow-up-client', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ client_id: 1, org: 'Example Org' }),
    })));
    // Following up must not also open the drawer.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
