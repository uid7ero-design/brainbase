import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Remaining visual islands pass (worker A) — the session lock screen and
// the super-admin Web Systems / Deployments / Agent runs / Administration
// surfaces rendered for real (jsdom) in light and dark, with every /api/...
// they call stubbed with small synthetic fixtures. Asserts the
// accessibility contract the convergence added (dialog semantics, a real
// password-visibility toggle, one h1, labelled controls, keyboard-openable
// kanban cards, tabs) and that the preserved requests are unchanged.
// Colour contrast is not computable in jsdom; hue/token contrast is pinned
// by tests/containment/remainingVisualIslandsA.test.ts.

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/app/actions/orgModules', () => ({
  getOrganisationCapabilities: vi.fn(async () => [
    { key: 'crm', name: 'CRM', active: true, enabled: true },
    { key: 'events', name: 'Events', active: false, enabled: false },
  ]),
  setOrganisationCapability: vi.fn(async () => ({ ok: true })),
}));

const { default: LockScreen } = await import('@/components/session/LockScreen');
const { default: WebServicesPipeline } = await import('@/app/admin/web-services/page');
const { default: DeploymentsDashboard } = await import('@/app/admin/deployments/page');
const { default: AgentRunsDashboard } = await import('@/app/admin/agent-runs/AgentRunsDashboard');
const { default: AdminClient } = await import('@/app/admin/orgs/AdminClient');

const NOW = new Date().toISOString();
const LEADS = [
  {
    id: 'lead-1', created_at: NOW, updated_at: NOW, full_name: 'Sam Example', business_name: 'Example Co',
    email: 'sam@example.test', phone: '0400 000 000', website_url: 'https://example.test', business_type: 'Retail',
    service_interest: ['website_design'], budget_range: '5000_10000', project_description: 'New site',
    status: 'new', source: 'website', notes: '', priority: 'high', score: 40, pipeline_notes: 'Call back',
  },
  {
    id: 'lead-2', created_at: NOW, updated_at: NOW, full_name: 'Kim Sample', business_name: null,
    email: 'kim@example.test', phone: null, website_url: null, business_type: null,
    service_interest: [], budget_range: null, project_description: null,
    status: 'active_client', source: null, notes: null, priority: null, score: null, pipeline_notes: null,
  },
];
const PROPOSALS = [{
  id: 'p-1', created_at: NOW, updated_at: NOW, lead_id: null, proposal_title: 'Example rollout',
  proposal_type: 'website_deployment', deployment_scope: null, monthly_recurring: 200, one_time_cost: 3000,
  status: 'draft', proposal_content: null, included_modules: ['CRM & Pipeline'], notes: null,
  sent_at: null, viewed_at: null, approved_at: null, lead_name: 'Sam Example', business_name: 'Example Co', lead_email: null,
}];
const ONBOARDING = [{
  id: 'o-1', client_name: 'Example Co', onboarding_stage: 'integrations', target_launch_date: null,
  hosting_status: 'complete', domain_status: 'in_progress', deployment_status: 'pending',
  integrations_status: 'pending', crm_status: 'pending', launch_status: 'pending',
  checklist: [{ id: 'c1', label: 'Collect logo', done: true }, { id: 'c2', label: 'DNS', done: false }],
  notes: null, created_at: NOW, lead_name: 'Sam Example', business_name: null, proposal_title: null, monthly_recurring: 200,
}];
const SERVICES = {
  services: [{
    id: 's-1', client_name: 'Example Co', domain_name: 'example.test', hosting_provider: 'Vercel',
    maintenance_plan: 'growth', monthly_value: 150, renewal_date: NOW, ssl_status: 'active', status: 'active', notes: null,
  }],
  metrics: { active_count: 1, mrr: 150, renewing_soon: 1 },
};
const AGENT_RUNS = {
  stats: { total_runs: 12, fallback_count: 2, avg_confidence: 0.82 },
  byAgent: [{ agent_name: 'InsightAgent', count: 8, avg_conf: 0.9 }, { agent_name: 'HLNAChatAgent', count: 4, avg_conf: null }],
  byRoute: [{ route_type: 'insight', count: 8 }, { route_type: 'chat', count: 4 }],
  recent: [{ id: 'r1', agent_name: 'InsightAgent', route_type: 'insight', input_query: 'What changed?', confidence: 0.9, source_rows: 20, created_at: NOW, org_name: 'Example Org' }],
  topRoute: 'insight',
  orgs: [{ id: 'org-1', name: 'Example Org' }],
};

let fetchMock: ReturnType<typeof vi.fn>;
const json = (b: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  push.mockReset();
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/web-services/leads?')) return json({ leads: LEADS });
    if (/^\/api\/web-services\/leads\/[^/]+\/messages$/.test(url)) return json({ messages: [] });
    if (url === '/api/web-services/proposals?limit=100') return json({ proposals: PROPOSALS });
    if (url === '/api/deployments/onboarding') return json({ onboarding: ONBOARDING });
    if (url === '/api/deployments/managed-services?status=ALL') return json(SERVICES);
    if (url.startsWith('/api/admin/agent-runs?')) return json(AGENT_RUNS);
    if (url === '/api/admin/founder-clients') return json({ clients: [{ organisation_id: 'org-1', stage: 'demo', estimated_value: 900, next_action: 'Send deck' }] });
    if (url === '/api/auth/verify-lock') return json({ error: 'Incorrect password.' }, 401);
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

// ── Lock screen ─────────────────────────────────────────────────────────────

describe.each(['light', 'dark'] as const)('LockScreen (%s)', theme => {
  it('is a labelled modal dialog with a labelled password field, a real visibility toggle and no axe violations', async () => {
    const { container, user } = renderBrainbase(<LockScreen name="Alex Example" onUnlock={vi.fn()} />, { theme });
    const dialog = screen.getByRole('dialog', { name: 'Session Locked' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/Locked due to inactivity\.\s*Continue as Alex/);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).not.toHaveAttribute('tabindex', '-1');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(input).toHaveAttribute('type', 'text');

    expect(screen.getByRole('button', { name: 'Unlock Session' })).toBeDisabled();
    await expectNoAxeViolations(container);
  });
});

describe('LockScreen behaviour is unchanged', () => {
  it('autofocuses the password field after the same 350ms delay', () => {
    vi.useFakeTimers();
    try {
      renderBrainbase(<LockScreen name="Alex" onUnlock={vi.fn()} />);
      const input = screen.getByLabelText('Password');
      expect(input).not.toHaveFocus();
      vi.advanceTimersByTime(350);
      expect(input).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('posts the password to /api/auth/verify-lock, shows the error as an alert, counts attempts and offers sign-in after three', async () => {
    const onUnlock = vi.fn();
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={onUnlock} />);
    const input = screen.getByLabelText('Password');
    for (let i = 0; i < 3; i++) {
      await user.type(input, 'wrong-pass');
      await user.click(screen.getByRole('button', { name: 'Unlock Session' }));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect password.'));
    }
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-pass' }),
    });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveValue('');
    expect(onUnlock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login');
  });

  it('calls onUnlock when the server accepts the password', async () => {
    fetchMock.mockImplementationOnce(() => json({ ok: true }));
    const onUnlock = vi.fn();
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={onUnlock} />);
    await user.type(screen.getByLabelText('Password'), 'right-pass');
    await user.click(screen.getByRole('button', { name: 'Unlock Session' }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it('keeps Tab inside the dialog', async () => {
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={vi.fn()} />);
    const input = screen.getByLabelText('Password');
    await user.type(input, 'x');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    const submit = screen.getByRole('button', { name: 'Unlock Session' });
    submit.focus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
    await user.tab({ shift: true });
    expect(toggle).toHaveFocus();
  });
});

// ── Web Systems pipeline ────────────────────────────────────────────────────

describe.each(['light', 'dark'] as const)('Web Systems pipeline (%s)', theme => {
  it('renders one h1, metrics, a labelled toolbar and the board with no axe violations', async () => {
    const { container } = renderBrainbase(<main><WebServicesPipeline /></main>, { theme });
    await screen.findByText('Sam Example');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deployment Pipeline');
    expect(screen.getByLabelText('Search leads')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pipeline board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'kanban' })).toHaveAttribute('aria-pressed', 'true');
    await expectNoAxeViolations(container);
  });

  it('opens the lead drawer from the keyboard as a labelled dialog (axe clean)', async () => {
    const { container, user } = renderBrainbase(<main><WebServicesPipeline /></main>, { theme });
    const card = await screen.findByRole('button', { name: 'Sam Example' });
    expect(card).toHaveAttribute('draggable', 'true');
    card.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Sam Example' });
    expect(within(dialog).getByRole('link', { name: 'sam@example.test' })).toHaveAttribute('href', 'mailto:sam@example.test');
    expect(within(dialog).getByRole('button', { name: /New Enquiry/ })).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText('Pipeline Notes')).toHaveValue('Call back');
    expect(within(dialog).getByLabelText('Subject')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText('No messages sent yet.')).toBeInTheDocument());
    await expectNoAxeViolations(container);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Web Systems pipeline behaviour is unchanged', () => {
  it('list view is a real table; the row name button opens the drawer; stage moves PATCH the same payload', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/web-services/leads?')) return json({ leads: LEADS });
      if (/messages$/.test(url)) return json({ messages: [] });
      if (url === '/api/web-services/leads/lead-1' && init?.method === 'PATCH') return json({ lead: { ...LEADS[0], status: 'discovery' } });
      return json({}, 404);
    });
    const { user } = renderBrainbase(<main><WebServicesPipeline /></main>);
    await screen.findByText('Sam Example');
    await user.click(screen.getByRole('button', { name: 'list' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Contact', 'Status', 'Budget', 'Priority', 'Score', 'Updated']);
    await user.click(within(table).getByRole('button', { name: 'Sam Example' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sam Example' });
    await user.click(within(dialog).getByRole('button', { name: /Discovery/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'discovery' }),
    }));
  });

  it('drag and drop between columns still PATCHes the new status', async () => {
    const { container } = renderBrainbase(<main><WebServicesPipeline /></main>);
    const card = await screen.findByRole('button', { name: 'Sam Example' });
    const target = container.querySelector('section[aria-label^="Qualified"]') as HTMLElement;
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ status: 'qualified' }),
    })));
  });
});

// ── Deployments ─────────────────────────────────────────────────────────────

describe.each(['light', 'dark'] as const)('Deployment operations (%s)', theme => {
  it('renders one h1 and a tablist; every tab panel is axe clean', async () => {
    const { container, user } = renderBrainbase(<main><DeploymentsDashboard /></main>, { theme });
    await screen.findByText('Example rollout');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const tablist = screen.getByRole('tablist', { name: 'Deployment operations' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: '+ New Proposal' }));
    expect(screen.getByLabelText(/Proposal Title/)).toBeRequired();
    expect(screen.getByRole('button', { name: 'CRM & Pipeline' })).toHaveAttribute('aria-pressed', 'false');
    await expectNoAxeViolations(container);

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(within(tablist).getByRole('tab', { name: /Deployments/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('progressbar', { name: 'Deployment Progress' })).toHaveAttribute('aria-valuenow', '56');
    await expectNoAxeViolations(container);

    await user.keyboard('{End}');
    expect(within(tablist).getByRole('tab', { name: /Managed Services/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Managed services' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

describe('Deployment operations behaviour is unchanged', () => {
  it('fetches the same three sources and Mark Sent PATCHes the proposal status', async () => {
    const { user } = renderBrainbase(<main><DeploymentsDashboard /></main>);
    await screen.findByText('Example rollout');
    for (const url of ['/api/web-services/proposals?limit=100', '/api/deployments/onboarding', '/api/deployments/managed-services?status=ALL']) {
      expect(fetchMock).toHaveBeenCalledWith(url);
    }
    await user.click(screen.getByRole('button', { name: /Mark Sent/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/proposals/p-1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'sent' }),
    }));
  });
});

// ── Agent runs ──────────────────────────────────────────────────────────────

describe.each(['light', 'dark'] as const)('Agent runs (%s)', theme => {
  it('renders one h1, labelled filters, metrics and the runs table with no axe violations', async () => {
    const { container } = renderBrainbase(<main><AgentRunsDashboard orgs={[{ id: 'org-1', name: 'Example Org' }]} /></main>, { theme });
    await screen.findByText('What changed?');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const name of ['Organisation', 'From', 'to', 'Agent', 'Route type']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Recent runs' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/admin/agent-runs?'))).toBe(true);
    await expectNoAxeViolations(container);
  });
});

// ── Administration ──────────────────────────────────────────────────────────

describe.each(['light', 'dark'] as const)('Administration (%s)', theme => {
  it('renders one h1, the org table with the CRM stage label, and an axe-clean edit dialog', async () => {
    const orgs = [{ id: 'org-1', name: 'Example Org', slug: 'example-org', created_at: NOW }];
    const users = [{ id: 'u-1', username: 'sam', name: 'Sam Example', email: 'sam@example.test', role: 'admin', organisation_id: 'org-1', org_name: 'Example Org' }];
    const { container, user } = renderBrainbase(<main><AdminClient orgs={orgs} users={users} /></main>, { theme });
    await screen.findByText('DEMO');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText('Name')).toBeRequired();
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit — Example Org' });
    await within(dialog).findByText('CRM');
    expect(within(dialog).getByRole('heading', { name: 'Capabilities' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
