import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// Reviewer G1 — behaviour contracts for the remaining-visual-islands group A
// surfaces (lock screen, Web Systems pipeline + lead messages, Deployment
// operations, Agent runs, Administration). Every expected URL / method /
// body below is derived from the BASE commit ecb5b03, not from the current
// code, so a behavioural drift in the visual pass fails here. Queries use
// text / placeholders / roles that exist identically in base and current
// markup wherever possible. Synthetic fixtures only; fetch is stubbed.

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed mock signature
const getCaps = vi.fn(async (_orgId: string) => [
  { key: 'crm', name: 'CRM', active: true, enabled: true },
  { key: 'events', name: 'Events', active: true, enabled: false },
]);
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed mock signature
const setCap = vi.fn(async (_orgId: string, _key: string, _enabled: boolean) => ({ ok: true as const }));
vi.mock('@/app/actions/orgModules', () => ({
  getOrganisationCapabilities: (orgId: string) => getCaps(orgId),
  setOrganisationCapability: (orgId: string, key: string, enabled: boolean) => setCap(orgId, key, enabled),
}));

const { default: LockScreen } = await import('@/components/session/LockScreen');
const { default: WebServicesPipeline } = await import('@/app/admin/web-services/page');
const { default: DeploymentsDashboard } = await import('@/app/admin/deployments/page');
const { default: AgentRunsDashboard } = await import('@/app/admin/agent-runs/AgentRunsDashboard');
const { default: AdminClient } = await import('@/app/admin/orgs/AdminClient');

const NOW = new Date().toISOString();
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const LEAD_1 = {
  id: 'lead-1', created_at: NOW, updated_at: NOW, full_name: 'Sam Example', business_name: 'Example Co',
  email: 'sam@example.test', phone: null, website_url: null, business_type: null,
  service_interest: ['website_design'], budget_range: '5000_10000', project_description: null,
  status: 'new', source: null, notes: 'Old client note', priority: 'high', score: 40, pipeline_notes: 'Old pipeline note',
};
const LEAD_2 = {
  id: 'lead-2', created_at: NOW, updated_at: NOW, full_name: 'Kim Sample', business_name: null,
  email: 'kim@example.test', phone: null, website_url: null, business_type: null,
  service_interest: [], budget_range: null, project_description: null,
  status: 'active_client', source: null, notes: null, priority: null, score: null, pipeline_notes: null,
};

const PROPOSALS = [
  { id: 'p-draft', status: 'draft', proposal_title: 'Draft rollout' },
  { id: 'p-sent', status: 'sent', proposal_title: 'Sent rollout' },
  { id: 'p-viewed', status: 'viewed', proposal_title: 'Viewed rollout' },
  { id: 'p-approved', status: 'approved', proposal_title: 'Approved rollout' },
  { id: 'p-rejected', status: 'rejected', proposal_title: 'Rejected rollout' },
].map(p => ({
  created_at: NOW, updated_at: NOW, lead_id: null, proposal_type: 'website_deployment', deployment_scope: null,
  monthly_recurring: 0, one_time_cost: 0, proposal_content: null, included_modules: [], notes: null,
  sent_at: null, viewed_at: null, approved_at: null, lead_name: null, business_name: null, lead_email: null, ...p,
}));

const AGENT_RUNS = {
  stats: { total_runs: 1, fallback_count: 0, avg_confidence: 0.9 },
  byAgent: [], byRoute: [], recent: [], topRoute: null,
  orgs: [{ id: 'org-1', name: 'Example Org' }],
};

type Handler = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
let extra: Handler | null = null;
const json = (b: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(b), { status, headers: JSON_HEADERS }));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  getCaps.mockClear();
  setCap.mockClear();
  extra = null;
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url.startsWith('/api/web-services/leads?')) return json({ leads: [LEAD_1, LEAD_2] });
    if (/^\/api\/web-services\/leads\/[^/]+\/messages$/.test(url) && !init?.method) return json({ messages: [] });
    if (url === '/api/web-services/proposals?limit=100') return json({ proposals: PROPOSALS });
    if (url === '/api/deployments/onboarding') return json({ onboarding: [] });
    if (url === '/api/deployments/managed-services?status=ALL') return json({ services: [], metrics: { active_count: 0, mrr: 0, renewing_soon: 0 } });
    if (url.startsWith('/api/admin/agent-runs?')) return json(AGENT_RUNS);
    if (url === '/api/admin/founder-clients') return json({ clients: [{ organisation_id: 'org-1', stage: 'demo', estimated_value: 900, next_action: 'Send deck' }] });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** All calls made with a given URL (+ optional method). */
function callsTo(url: string, method?: string) {
  return fetchMock.mock.calls.filter(([u, init]) =>
    String(u) === url && (method === undefined || (init as RequestInit | undefined)?.method === method));
}

// ── LockScreen ───────────────────────────────────────────────────────────────

describe('G1 contract — LockScreen', () => {
  function passwordInput() {
    return screen.getByPlaceholderText('Enter your password') as HTMLInputElement;
  }

  it('focuses the password field after the base 350ms delay (not before)', () => {
    vi.useFakeTimers();
    renderBrainbase(<LockScreen name="Alex Example" onUnlock={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(349); });
    expect(passwordInput()).not.toHaveFocus();
    act(() => { vi.advanceTimersByTime(1); });
    expect(passwordInput()).toHaveFocus();
  });

  it('Enter in the password field POSTs {password} to /api/auth/verify-lock and success calls onUnlock', async () => {
    extra = url => (url === '/api/auth/verify-lock' ? json({ ok: true }) : undefined);
    const onUnlock = vi.fn();
    const { user } = renderBrainbase(<LockScreen name="Alex Example" onUnlock={onUnlock} />);
    await user.type(passwordInput(), 's3cret{Enter}');
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-lock', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ password: 's3cret' }),
    });
  });

  it('the Unlock Session submit button sends the same request', async () => {
    extra = url => (url === '/api/auth/verify-lock' ? json({ ok: true }) : undefined);
    const onUnlock = vi.fn();
    const { user } = renderBrainbase(<LockScreen name="Alex Example" onUnlock={onUnlock} />);
    const submit = screen.getByRole('button', { name: 'Unlock Session' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit).toBeDisabled();
    await user.type(passwordInput(), 'abc');
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-lock', expect.objectContaining({ body: JSON.stringify({ password: 'abc' }) }));
  });

  it('empty password never calls the endpoint', async () => {
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={vi.fn()} />);
    await user.click(passwordInput());
    await user.keyboard('{Enter}');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('failure shows the server error, clears the field and does not unlock; missing error falls back to "Incorrect password."', async () => {
    let n = 0;
    extra = url => (url === '/api/auth/verify-lock'
      ? (n++ === 0 ? json({ error: 'Too many attempts.' }, 429) : json({}, 401))
      : undefined);
    const onUnlock = vi.fn();
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={onUnlock} />);
    await user.type(passwordInput(), 'bad{Enter}');
    expect(await screen.findByText('Too many attempts.')).toBeInTheDocument();
    expect(passwordInput()).toHaveValue('');
    await user.type(passwordInput(), 'bad2{Enter}');
    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
    expect(onUnlock).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Sign in again' })).toBeNull();
    await user.type(passwordInput(), 'bad3{Enter}');
    expect(await screen.findByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login');
  });

  it('a network failure shows the base connection error', async () => {
    extra = url => (url === '/api/auth/verify-lock' ? Promise.reject(new TypeError('offline')) : undefined);
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={vi.fn()} />);
    await user.type(passwordInput(), 'pw{Enter}');
    expect(await screen.findByText('Connection error. Please try again.')).toBeInTheDocument();
  });

  it('the visibility toggle is type="button", has a name, toggles aria-pressed and the input type, and never submits', async () => {
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={vi.fn()} />);
    await user.type(passwordInput(), 'pw');
    const form = passwordInput().closest('form')!;
    const toggle = within(form).getAllByRole('button').find(b => b.getAttribute('type') === 'button')!;
    expect(toggle).toBeDefined();
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAccessibleName();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(passwordInput()).toHaveAttribute('type', 'password');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(passwordInput()).toHaveAttribute('type', 'text');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(passwordInput()).toHaveAttribute('type', 'password');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('there is no Escape-to-dismiss: Escape neither unlocks nor removes the lock', async () => {
    const onUnlock = vi.fn();
    const { user } = renderBrainbase(<LockScreen name="Alex" onUnlock={onUnlock} />);
    await user.click(passwordInput());
    await user.keyboard('{Escape}');
    expect(onUnlock).not.toHaveBeenCalled();
    expect(screen.getByText('Session Locked')).toBeInTheDocument();
  });
});

// ── Web Systems pipeline ─────────────────────────────────────────────────────

describe('G1 contract — Web Systems pipeline', () => {
  async function renderPipeline() {
    const r = renderBrainbase(<main><WebServicesPipeline /></main>);
    await screen.findByText('Sam Example');
    return r;
  }

  async function openLead(user: ReturnType<typeof renderBrainbase>['user']) {
    await user.click(screen.getByText('Sam Example'));
    return screen.findByText('Move to stage');
  }

  /** Returns the drawer container (the element that holds "Move to stage"). */
  function drawer(): HTMLElement {
    return (screen.getByRole('dialog') as HTMLElement);
  }

  it('loads /api/web-services/leads?limit=200 and search adds &search=', async () => {
    const { user } = await renderPipeline();
    expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads?limit=200');
    await user.type(screen.getByPlaceholderText('Search leads…'), 'Sam');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads?limit=200&search=Sam'));
  });

  it('Refresh re-requests the same list URL', async () => {
    const { user } = await renderPipeline();
    const before = callsTo('/api/web-services/leads?limit=200').length;
    await user.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(callsTo('/api/web-services/leads?limit=200').length).toBe(before + 1));
  });

  it('drop onto a different column PATCHes {status} to /api/web-services/leads/:id (base body/headers)', async () => {
    const { container } = await renderPipeline();
    const card = screen.getByText('Sam Example').closest('[draggable="true"]') as HTMLElement;
    const target = Array.from(container.querySelectorAll<HTMLElement>('*')).find(el =>
      el.getAttribute('aria-label')?.startsWith('Discovery') || false)!;
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'discovery' }),
    }));
  });

  it('drop onto the same column sends nothing', async () => {
    const { container } = await renderPipeline();
    const card = screen.getByText('Sam Example').closest('[draggable="true"]') as HTMLElement;
    const same = Array.from(container.querySelectorAll<HTMLElement>('[aria-label]')).find(el =>
      el.getAttribute('aria-label')!.startsWith('New Enquiry'))!;
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(same, { dataTransfer });
    await new Promise(r => setTimeout(r, 20));
    expect(callsTo('/api/web-services/leads/lead-1', 'PATCH')).toHaveLength(0);
  });

  it('stage group filter keeps only that group (Retention hides the new lead)', async () => {
    const { user } = await renderPipeline();
    await user.click(screen.getByRole('button', { name: 'list' }));
    await user.click(screen.getByRole('button', { name: 'Retention' }));
    expect(screen.queryByText('Sam Example')).toBeNull();
    expect(screen.getByText('Kim Sample')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retention' }));
    expect(screen.getByText('Sam Example')).toBeInTheDocument();
  });

  it('drawer opens on card click and closes via its close button', async () => {
    const { user } = await renderPipeline();
    await openLead(user);
    const close = within(drawer()).getAllByRole('button').find(b => /close|✕/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))!;
    await user.click(close);
    await waitFor(() => expect(screen.queryByText('Move to stage')).toBeNull());
  });

  it('drawer stage, priority and score controls PATCH the base payloads', async () => {
    extra = (url, init) => (url === '/api/web-services/leads/lead-1' && init?.method === 'PATCH'
      ? json({ lead: { ...LEAD_1, ...JSON.parse(String(init.body)) } }) : undefined);
    const { user } = await renderPipeline();
    await openLead(user);
    const d = drawer();
    // Current stage is disabled (base: disabled={saving || lead.status === c.status}).
    expect(within(d).getByRole('button', { name: /New Enquiry/ })).toBeDisabled();
    await user.click(within(d).getByRole('button', { name: /Qualified/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'qualified' }),
    }));
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Low' })).toBeEnabled());
    await user.click(within(d).getByRole('button', { name: 'Low' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ priority: 'low' }),
    }));
    const score = within(d).getByRole('spinbutton');
    await user.clear(score);
    await user.type(score, '150');
    fireEvent.blur(score);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ score: 100 }),
    }));
  });

  it('pipeline-notes and client-notes save buttons PATCH {pipeline_notes} / {notes}', async () => {
    extra = (url, init) => (url === '/api/web-services/leads/lead-1' && init?.method === 'PATCH'
      ? json({ lead: { ...LEAD_1, ...JSON.parse(String(init.body)) } }) : undefined);
    const { user } = await renderPipeline();
    await openLead(user);
    const d = drawer();
    const savePipeline = within(d).getByRole('button', { name: 'Save pipeline notes' });
    expect(savePipeline).toBeDisabled();
    const pipelineBox = within(d).getByPlaceholderText('Internal operational notes…');
    await user.clear(pipelineBox);
    await user.type(pipelineBox, 'Ring Tuesday');
    await user.click(savePipeline);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ pipeline_notes: 'Ring Tuesday' }),
    }));
    const notesBox = within(d).getByPlaceholderText('Notes visible to client…');
    await user.clear(notesBox);
    await user.type(notesBox, 'Hello');
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Save notes' })).toBeEnabled());
    await user.click(within(d).getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ notes: 'Hello' }),
    }));
  });

  it('delete requires confirmation; Cancel sends nothing; "Yes, delete" sends DELETE and closes the drawer', async () => {
    extra = (url, init) => (url === '/api/web-services/leads/lead-1' && init?.method === 'DELETE' ? json({ ok: true }) : undefined);
    const { user } = await renderPipeline();
    await openLead(user);
    await user.click(within(drawer()).getByRole('button', { name: 'Delete lead' }));
    await user.click(within(drawer()).getByRole('button', { name: 'Cancel' }));
    expect(callsTo('/api/web-services/leads/lead-1', 'DELETE')).toHaveLength(0);
    await user.click(within(drawer()).getByRole('button', { name: 'Delete lead' }));
    expect(within(drawer()).getByText('Confirm delete?')).toBeInTheDocument();
    await user.click(within(drawer()).getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1', { method: 'DELETE' }));
    await waitFor(() => expect(screen.queryByText('Move to stage')).toBeNull());
    await waitFor(() => expect(screen.queryByText('Sam Example')).toBeNull());
  });

  it('lead messages: GET history, POST trimmed {subject, body}, append on success', async () => {
    extra = (url, init) => (url === '/api/web-services/leads/lead-1/messages' && init?.method === 'POST'
      ? json({ message: { id: 'm1', direction: 'outbound', subject: 'Hi', body: 'There', from_address: 'a', to_address: 'b', resend_message_id: null, created_by: null, created_at: NOW, sender_name: null } })
      : undefined);
    const { user } = await renderPipeline();
    await openLead(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1/messages'));
    const d = drawer();
    const send = within(d).getByRole('button', { name: 'Send Email' });
    expect(send).toBeDisabled();
    await user.type(within(d).getByPlaceholderText('Subject'), '  Hi  ');
    await user.type(within(d).getByPlaceholderText('Write your message…'), ' There ');
    await user.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/web-services/leads/lead-1/messages', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ subject: 'Hi', body: 'There' }),
    }));
    await waitFor(() => expect(within(d).getByPlaceholderText('Subject')).toHaveValue(''));
    expect(within(d).getByText('There')).toBeInTheDocument();
  });

  it('lead messages: server error and warning are surfaced verbatim', async () => {
    let n = 0;
    extra = (url, init) => (url === '/api/web-services/leads/lead-1/messages' && init?.method === 'POST'
      ? (n++ === 0 ? json({ error: 'Resend down' }, 502) : json({ warning: 'Sent but not logged' }))
      : undefined);
    const { user } = await renderPipeline();
    await openLead(user);
    const d = drawer();
    await user.type(within(d).getByPlaceholderText('Subject'), 'S');
    await user.type(within(d).getByPlaceholderText('Write your message…'), 'B');
    await user.click(within(d).getByRole('button', { name: 'Send Email' }));
    expect(await within(d).findByText('Resend down')).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Send Email' }));
    expect(await within(d).findByText('Sent but not logged')).toBeInTheDocument();
    expect(callsTo('/api/web-services/leads/lead-1/messages', 'POST')).toHaveLength(2);
  });
});

// ── Deployments ──────────────────────────────────────────────────────────────

describe('G1 contract — Deployment operations', () => {
  async function renderDeployments() {
    const r = renderBrainbase(<main><DeploymentsDashboard /></main>);
    await screen.findByText('Draft rollout');
    return r;
  }

  it('fetches exactly the three base sources on mount', async () => {
    await renderDeployments();
    expect(fetchMock.mock.calls.map(([u]) => String(u)).sort()).toEqual([
      '/api/deployments/managed-services?status=ALL',
      '/api/deployments/onboarding',
      '/api/web-services/proposals?limit=100',
    ]);
  });

  it('status-advance actions PATCH {status} exactly as base: draft→sent, sent→viewed, viewed→approved; none for approved/rejected', async () => {
    extra = (url, init) => (url.startsWith('/api/web-services/proposals/') && init?.method === 'PATCH' ? json({}) : undefined);
    const { user } = await renderDeployments();
    await user.click(screen.getByRole('button', { name: /Mark Sent/ }));
    await user.click(screen.getByRole('button', { name: /Mark Viewed/ }));
    await user.click(screen.getByRole('button', { name: /Mark Approved/ }));
    await waitFor(() => expect(callsTo('/api/web-services/proposals/p-viewed', 'PATCH')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/web-services/proposals/p-draft', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'sent' }) });
    expect(fetchMock).toHaveBeenCalledWith('/api/web-services/proposals/p-sent', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'viewed' }) });
    expect(fetchMock).toHaveBeenCalledWith('/api/web-services/proposals/p-viewed', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'approved' }) });
    // Base has exactly one advance button per draft/sent/viewed card and no reject action.
    expect(screen.getAllByRole('button', { name: /^Mark / })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull();
  });

  it('deployment-type options are the base five proposal types, default website_deployment', async () => {
    const { user } = await renderDeployments();
    await user.click(screen.getByRole('button', { name: /New Proposal/ }));
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('website_deployment');
    expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([
      ['website_deployment', 'Website'],
      ['operational_deployment', 'Operational'],
      ['coaching_deployment', 'Coaching'],
      ['automation_deployment', 'Automation'],
      ['full_system', 'Full System'],
    ]);
  });

  it('Create Proposal POSTs the base body (numbers parsed, modules, type) and closes the form', async () => {
    extra = (url, init) => (url === '/api/web-services/proposals' && init?.method === 'POST'
      ? json({ proposal: { ...PROPOSALS[0], id: 'p-new', proposal_title: 'New thing' } }) : undefined);
    const { user } = await renderDeployments();
    await user.click(screen.getByRole('button', { name: /New Proposal/ }));
    const create = screen.getByRole('button', { name: 'Create Proposal' });
    expect(create).toBeDisabled();
    await user.type(screen.getByPlaceholderText('e.g. LD Tennis — Full System Deployment'), 'New thing');
    await user.selectOptions(screen.getByRole('combobox'), 'full_system');
    const [oneTime, monthly] = screen.getAllByPlaceholderText('0');
    await user.type(oneTime, '2500');
    await user.type(monthly, '99.5');
    await user.type(screen.getByPlaceholderText('What is included in this deployment…'), 'Scope');
    await user.click(screen.getByRole('button', { name: 'Dashboards' }));
    await user.click(screen.getByRole('button', { name: 'CRM & Pipeline' }));
    await user.type(screen.getByPlaceholderText('Internal notes…'), 'N');
    await user.click(create);
    await waitFor(() => expect(callsTo('/api/web-services/proposals', 'POST')).toHaveLength(1));
    const [, init] = callsTo('/api/web-services/proposals', 'POST')[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(JSON_HEADERS);
    expect(init.body).toBe(JSON.stringify({
      proposal_title: 'New thing', proposal_type: 'full_system', deployment_scope: 'Scope',
      monthly_recurring: 99.5, one_time_cost: 2500, proposal_content: '',
      included_modules: ['Dashboards', 'CRM & Pipeline'], notes: 'N',
    }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create Proposal' })).toBeNull());
    expect(screen.getByText('New thing')).toBeInTheDocument();
  });
});

// ── Agent runs ───────────────────────────────────────────────────────────────

describe('G1 contract — Agent runs', () => {
  const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().split('T')[0];
  const lastUrl = () => String(fetchMock.mock.calls.at(-1)![0]);

  it('requests /api/admin/agent-runs with the base default window, then each filter as a query param; Reset restores defaults', async () => {
    const { user } = renderBrainbase(<main><AgentRunsDashboard orgs={[{ id: 'org-1', name: 'Example Org' }]} /></main>);
    const base = `/api/admin/agent-runs?from=${iso(-7)}&to=${iso(0)}`;
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(base));
    const [org, agent, route] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(Array.from(agent.options).map(o => o.value)).toEqual(['', 'InsightAgent', 'ActionAgent', 'BriefingAgent', 'DataIntakeAgent', 'HLNAChatAgent']);
    expect(Array.from(route.options).map(o => o.value)).toEqual(['', 'insight', 'action', 'briefing', 'dataIntake', 'chat']);

    await user.selectOptions(org, 'org-1');
    await waitFor(() => expect(lastUrl()).toBe(`/api/admin/agent-runs?orgId=org-1&from=${iso(-7)}&to=${iso(0)}`));
    await user.selectOptions(agent, 'ActionAgent');
    await waitFor(() => expect(lastUrl()).toBe(`/api/admin/agent-runs?orgId=org-1&from=${iso(-7)}&to=${iso(0)}&agentName=ActionAgent`));
    await user.selectOptions(route, 'chat');
    await waitFor(() => expect(lastUrl()).toBe(`/api/admin/agent-runs?orgId=org-1&from=${iso(-7)}&to=${iso(0)}&agentName=ActionAgent&routeType=chat`));

    const dates = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    expect(dates).toHaveLength(2);
    fireEvent.change(dates[0], { target: { value: '2026-01-01' } });
    await waitFor(() => expect(lastUrl()).toBe(`/api/admin/agent-runs?orgId=org-1&from=2026-01-01&to=${iso(0)}&agentName=ActionAgent&routeType=chat`));

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(lastUrl()).toBe(base));
  });

  it('a non-OK response surfaces "HTTP <status>"', async () => {
    extra = url => (url.startsWith('/api/admin/agent-runs?') ? json({}, 503) : undefined);
    renderBrainbase(<main><AgentRunsDashboard orgs={[]} /></main>);
    expect(await screen.findByText('HTTP 503')).toBeInTheDocument();
  });
});

// ── Administration ───────────────────────────────────────────────────────────

describe('G1 contract — AdminClient', () => {
  const ORGS = [{ id: 'org-1', name: 'Example Org', slug: 'example-org', created_at: NOW }];
  const USERS = [{ id: 'u-1', username: 'sam', name: 'Sam Example', email: 'sam@example.test', role: 'admin', organisation_id: 'org-1', org_name: 'Example Org' }];

  function renderAdmin() {
    return renderBrainbase(<main><AdminClient orgs={ORGS} users={USERS} /></main>);
  }

  it('loads /api/admin/founder-clients and "View in Founder OS" pushes /admin/founder', async () => {
    const { user } = renderAdmin();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/founder-clients');
    await user.click(await screen.findByRole('button', { name: /View in Founder OS/ }));
    expect(push).toHaveBeenCalledWith('/admin/founder');
  });

  it('create organisation POSTs {name, slug} (slugified) and refreshes the router', async () => {
    extra = (url, init) => (url === '/api/admin/orgs' && init?.method === 'POST'
      ? json({ org: { id: 'org-2', name: 'New Council', slug: 'new-council', created_at: NOW } }) : undefined);
    const { user } = renderAdmin();
    await user.type(screen.getByPlaceholderText('City of Springfield'), 'New Council');
    expect(screen.getByPlaceholderText('city-of-springfield')).toHaveValue('new-council');
    await user.click(screen.getByRole('button', { name: 'Create Organisation' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/orgs', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: 'New Council', slug: 'new-council' }),
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText('Organisation "New Council" created.')).toBeInTheDocument();
  });

  it('edit organisation PATCHes /api/admin/orgs?id=… and loads/sets capabilities via the server actions', async () => {
    extra = (url, init) => (url === '/api/admin/orgs?id=org-1' && init?.method === 'PATCH'
      ? json({ org: { ...ORGS[0], name: 'Renamed Org' } }) : undefined);
    const { user } = renderAdmin();
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('CRM');
    expect(getCaps).toHaveBeenCalledWith('org-1');
    const crm = within(dialog).getByRole('checkbox', { name: /CRM/ });
    await user.click(crm);
    await waitFor(() => expect(setCap).toHaveBeenCalledWith('org-1', 'crm', false));
    await waitFor(() => expect(getCaps).toHaveBeenCalledTimes(2));
    const events = within(dialog).getByRole('checkbox', { name: /Events/ });
    await waitFor(() => expect(events).toBeEnabled());
    await user.click(events);
    await waitFor(() => expect(setCap).toHaveBeenCalledWith('org-1', 'events', true));

    const nameInput = within(dialog).getByDisplayValue('Example Org');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Org');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/orgs?id=org-1', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name: 'Renamed Org', slug: 'example-org' }),
    }));
  });

  it('delete organisation asks confirm() with the base text and sends DELETE only when confirmed', async () => {
    extra = (url, init) => (url === '/api/admin/orgs?id=org-1' && init?.method === 'DELETE' ? json({ ok: true }) : undefined);
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    const { user } = renderAdmin();
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(confirmMock).toHaveBeenCalledWith('Delete "Example Org"? This cannot be undone.');
    expect(callsTo('/api/admin/orgs?id=org-1', 'DELETE')).toHaveLength(0);
    confirmMock.mockReturnValue(true);
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/orgs?id=org-1', { method: 'DELETE' }));
  });

  it('create user POSTs the base userForm body and refreshes', async () => {
    extra = (url, init) => (url === '/api/admin/users' && init?.method === 'POST'
      ? json({ user: { ...USERS[0], id: 'u-2', username: 'jane.smith' } }) : undefined);
    const { user } = renderAdmin();
    await user.click(screen.getByRole('button', { name: /^Users/ }));
    await user.type(screen.getByPlaceholderText('Jane Smith'), 'Jane Smith');
    await user.type(screen.getByPlaceholderText('jane.smith'), 'jane.smith');
    await user.type(screen.getByPlaceholderText('8+ characters'), 'password123');
    await user.type(screen.getByPlaceholderText('jane@council.gov.au'), 'jane@example.test');
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await user.selectOptions(selects[0], 'viewer');
    await user.selectOptions(selects[1], 'org-1');
    await user.click(screen.getByRole('button', { name: 'Create User' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/users', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'jane.smith', password: 'password123', name: 'Jane Smith', email: 'jane@example.test', role: 'viewer', organisationId: 'org-1' }),
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('edit user PATCHes /api/admin/users?id=… (password only when given); delete user confirms then DELETEs', async () => {
    extra = (url, init) => {
      if (url === '/api/admin/users?id=u-1' && init?.method === 'PATCH') return json({ user: USERS[0] });
      if (url === '/api/admin/users?id=u-1' && init?.method === 'DELETE') return json({ ok: true });
      return undefined;
    };
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);
    const { user } = renderAdmin();
    await user.click(screen.getByRole('button', { name: /^Users/ }));
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/users?id=u-1', {
      method: 'PATCH', headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Sam Example', role: 'admin', organisationId: 'org-1', email: 'sam@example.test' }),
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(confirmMock).toHaveBeenCalledWith('Delete user "sam"? This cannot be undone.');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/users?id=u-1', { method: 'DELETE' }));
  });
});
