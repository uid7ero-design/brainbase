import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase, type BrainbaseTheme } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Remaining visual islands pass — worker C surfaces rendered for real in
// light AND dark: /briefings, /data, /portal, /reports, /reports/[id].
// Every network call is a vi.fn() fetch mock returning synthetic fixtures;
// nothing is uploaded, deleted, submitted or confirmed for real.

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

const setLastUpload = vi.fn();
vi.mock('@/lib/state/useAppStore', () => ({
  useAppStore: (sel: (s: { setLastUpload: typeof setLastUpload }) => unknown) => sel({ setLastUpload }),
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ organisationId: 'org-test', role: 'admin' })),
}));

let reportRows: Record<string, unknown>[] = [];
vi.mock('@/lib/db', () => ({ default: vi.fn(async () => reportRows) }));

import BriefingsClient from '@/app/briefings/BriefingsClient';
import DataClient from '@/app/data/DataClient';
import PortalPage from '@/app/portal/page';
import ReportsPage from '@/app/reports/page';
import ReportView from '@/app/reports/[id]/ReportView';

type Route = (url: string, init?: RequestInit) => unknown;
const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);

let fetchMock: ReturnType<typeof vi.fn>;
function mockFetch(route: Route) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const res = route(String(url), init);
    return res instanceof Promise ? res : json(res ?? {});
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => false));
  push.mockReset();
  setLastUpload.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const THEMES: BrainbaseTheme[] = ['light', 'dark'];
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString();

// ── /briefings ──────────────────────────────────────────────────────────

const BRIEFINGS = [
  {
    id: 'b1', title: 'Weekly contamination summary', briefing_type: 'insight', agent_name: 'InsightAgent',
    response_text: 'Contamination fell 2.1 points week on week.', created_at: iso(90),
    evidence_json: {
      sourceDataset: ['waste_records'], sourceColumns: ['suburb', 'contamination_rate'],
      evidenceSummary: 'Twelve suburbs reported.', calculationUsed: 'avg(contamination_rate)',
      confidenceReason: 'Complete month of data.', sampleRows: [{ suburb: 'Northside', contamination_rate: 4.2 }],
    },
  },
  { id: 'b2', title: 'Follow-up actions', briefing_type: 'action', agent_name: 'UnknownAgent', response_text: null, evidence_json: null, created_at: iso(3000) },
];

describe.each(THEMES)('/briefings (%s)', theme => {
  it('renders one h1, filters with pressed state, expandable cards and evidence — no axe violations', async () => {
    mockFetch(url => (url.startsWith('/api/briefings') ? { briefings: BRIEFINGS } : {}));
    const { user, container } = renderBrainbase(<BriefingsClient />, { theme });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Saved Briefings' })).toBeInTheDocument();
    await screen.findByText('Weekly contamination summary');
    expect(fetchMock).toHaveBeenCalledWith('/api/briefings');

    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');

    const toggle = screen.getByRole('button', { name: /Weekly contamination summary/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: '▼ VIEW EVIDENCE' }));
    expect(screen.getByText('avg(contamination_rate)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sample data' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'contamination_rate' })).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Insight' }));
    expect(screen.getByRole('button', { name: 'Insight' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/briefings?type=insight'));
  });

  it('delete keeps its request shape (mocked) and removes the card', async () => {
    mockFetch(url => (url.startsWith('/api/briefings?id=') ? { ok: true } : { briefings: BRIEFINGS }));
    const { user } = renderBrainbase(<BriefingsClient />, { theme });
    await user.click(await screen.findByRole('button', { name: /Weekly contamination summary/ }));
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    expect(fetchMock).toHaveBeenCalledWith('/api/briefings?id=b1', { method: 'DELETE' });
    await waitFor(() => expect(screen.queryByText('Weekly contamination summary')).not.toBeInTheDocument());
  });

  it('empty state', async () => {
    mockFetch(() => ({ briefings: [] }));
    const { container } = renderBrainbase(<BriefingsClient />, { theme });
    expect(await screen.findByText('No saved briefings yet')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

// ── /data ───────────────────────────────────────────────────────────────

const FILES = [
  { id: 'f1', file_name: 'collections-2026.xlsx', file_type: 'xlsx', upload_status: 'complete', created_at: iso(60), uploaded_by_name: 'Test User', record_count: 1200 },
  { id: 'f2', file_name: 'pending.csv', file_type: 'csv', upload_status: 'processing', created_at: iso(10), uploaded_by_name: 'Test User', record_count: 0 },
  { id: 'f3', file_name: 'broken.xls', file_type: 'xls', upload_status: 'error', created_at: iso(5), uploaded_by_name: 'Test User', record_count: 0 },
];
const RECORDS = [
  { id: 'r1', service_type: 'General waste', suburb: 'Northside', month: 'Jan', financial_year: 'FY26', tonnes: 12.5, collections: 40, contamination_rate: 3.1, cost: 1500 },
];

describe.each(THEMES)('/data (%s)', theme => {
  it('renders files with semantic status, records panel and the report dialog — no axe violations', async () => {
    mockFetch(url => {
      if (url === '/api/files') return { files: FILES };
      if (url === '/api/files/f1') return { records: RECORDS };
      return {};
    });
    const { user, container } = renderBrainbase(<DataClient canDelete />, { theme });

    expect(screen.getByRole('heading', { level: 1, name: 'Data' })).toBeInTheDocument();
    const table = await screen.findByRole('region', { name: 'Uploaded files' });
    expect(within(table).getByText('collections-2026.xlsx')).toBeInTheDocument();
    for (const s of ['complete', 'processing', 'error']) expect(within(table).getByText(s)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drag & drop or click to upload/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(3);
    await expectNoAxeViolations(container);

    const view = screen.getByRole('button', { name: 'View records for collections-2026.xlsx' });
    await user.click(view);
    expect(fetchMock).toHaveBeenCalledWith('/api/files/f1');
    expect(await screen.findByText('Northside')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Records/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide records for collections-2026.xlsx' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Generate Report' }));
    const dialog = screen.getByRole('dialog', { name: 'Generate Report' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('Report Type')).toHaveValue('waste_summary');
    expect(within(dialog).getByLabelText(/Source File/)).toHaveValue('f1');
    await expectNoAxeViolations(container);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('delete is gated by canDelete and still asks for confirmation first (declined → no request)', async () => {
    mockFetch(url => (url === '/api/files' ? { files: FILES } : {}));
    const { user, unmount } = renderBrainbase(<DataClient canDelete />, { theme });
    await user.click(await screen.findByRole('button', { name: 'Delete collections-2026.xlsx' }));
    expect(globalThis.confirm).toHaveBeenCalledWith('Delete this file and all its waste records?');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/files/f1', { method: 'DELETE' });
    unmount();
    renderBrainbase(<DataClient canDelete={false} />, { theme });
    await screen.findAllByText('collections-2026.xlsx');
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
  });

  it('Generate Report is disabled without a complete file; empty table state', async () => {
    mockFetch(() => ({ files: [] }));
    const { container } = renderBrainbase(<DataClient canDelete={false} />, { theme });
    expect(await screen.findByText('No files uploaded yet. Upload a spreadsheet above.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Report' })).toBeDisabled();
    await expectNoAxeViolations(container);
  });

  it('401 shows the session-expired view with one h1', async () => {
    mockFetch(() => json({}, 401));
    const { container } = renderBrainbase(<DataClient canDelete={false} />, { theme });
    expect(await screen.findByRole('heading', { level: 1, name: 'Session expired' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out and back in' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});

// ── /portal ─────────────────────────────────────────────────────────────

const REQUESTS = [
  {
    id: 'q1', type: 'request', title: 'Add a squad roster export', description: 'CSV would be great.',
    status: 'awaiting_client', priority: 'normal', created_at: iso(2000),
    booking: { id: 'bk1', date: '2026-10-02', time: '10:00', session_type: 'Onboarding', status: 'pending_confirmation', confirmed_at: null },
  },
  { id: 'q2', type: 'issue', title: 'Login loop on mobile', description: null, status: 'resolved', priority: 'high', created_at: iso(10), booking: null },
  { id: 'q3', type: 'feedback', title: 'Love the calendar', description: null, status: 'awaiting_client', priority: 'low', created_at: iso(10), booking: null },
];
const MESSAGES = [
  { id: 'm1', author_type: 'founder', body: 'Can you share an example file?', created_at: iso(100) },
  { id: 'm2', author_type: 'client', body: 'Attached below.', created_at: iso(50) },
];

describe.each(THEMES)('/portal (%s)', theme => {
  it('renders requests, statuses, booking controls and the thread — no axe violations', async () => {
    mockFetch(url => {
      if (url === '/api/portal/pipeline') return { requests: REQUESTS };
      if (url === '/api/portal/pipeline/q1/messages') return { messages: MESSAGES };
      if (url === '/api/portal/pipeline/q3/messages') return { messages: [] };
      return {};
    });
    const { user, container } = renderBrainbase(<PortalPage />, { theme });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const first = await screen.findByRole('button', { name: /Add a squad roster export/ });
    expect(within(first).getByText('Session proposed')).toBeInTheDocument();
    expect(within(first).getByText('Awaiting your reply')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(fetchMock).toHaveBeenCalledWith('/api/portal/pipeline/q1/messages');
    expect(await screen.findByText('Can you share an example file?')).toBeInTheDocument();
    expect(screen.getByText('Awaiting confirmation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Session' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request Change' }));
    expect(screen.getByRole('textbox', { name: 'What time works for you? (optional)' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add a message' })).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: /Love the calendar/ }));
    expect(await screen.findByText('Your coach is waiting for your response')).toBeInTheDocument();

    // No write request was made by viewing.
    for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit | undefined)?.method).toBeUndefined();
  });

  it('new-request form: pressed type, labelled inputs, disabled submit until titled (nothing submitted)', async () => {
    mockFetch(() => ({ requests: [] }));
    const { user, container } = renderBrainbase(<PortalPage />, { theme });
    expect(await screen.findByText('No requests yet. Submit your first one above.')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '+ New request' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Feature request/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Bug \/ issue/ }));
    expect(screen.getByRole('button', { name: /Bug \/ issue/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Short title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await expectNoAxeViolations(container);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── /reports + /reports/[id] ────────────────────────────────────────────

describe.each(THEMES)('/reports (%s)', theme => {
  it('list: one h1, table contract, type label with decorative dot — no axe violations', async () => {
    reportRows = [
      { id: 'r1', report_type: 'diversion_rate', report_title: 'Q3 diversion', created_at: iso(60), created_by_name: 'Test User', source_file_name: 'collections-2026.xlsx' },
      { id: 'r2', report_type: 'mystery', report_title: 'Ad hoc', created_at: iso(30), created_by_name: 'Test User', source_file_name: null },
    ];
    const { container } = renderBrainbase(await ReportsPage(), { theme });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const region = screen.getByRole('region', { name: 'Reports' });
    expect(within(region).getByText('Diversion Rate')).toBeInTheDocument();
    expect(within(region).getByText('mystery')).toBeInTheDocument();
    expect(within(region).getByText('All data')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Q3 diversion' })).toHaveAttribute('href', '/reports/r1');
    await expectNoAxeViolations(container);
  });

  it('list: empty state keeps the /data destination', async () => {
    reportRows = [];
    const { container } = renderBrainbase(await ReportsPage(), { theme });
    expect(screen.getByText('No reports yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload data and generate your first report →' })).toHaveAttribute('href', '/data');
    await expectNoAxeViolations(container);
  });

  it('detail: chrome converged, generated content rendered — no axe violations', async () => {
    const { container } = renderBrainbase(
      <ReportView
        id="r1" title="Q3 diversion" reportType="diversion_rate" content={'## Summary\n\nDiversion rose to **48%**.\n\n- Organics up\n- Recycling flat'}
        createdByName="Test User" organisationName="Synthetic Council" sourceFileName="collections-2026.xlsx"
        createdAt={iso(60)} canDelete
      />,
      { theme },
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Q3 diversion' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Reports' })).toHaveAttribute('href', '/reports');
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    const article = screen.getByRole('article', { name: 'Q3 diversion' });
    expect(article.innerHTML).toContain('<h2>Summary</h2>');
    expect(article.innerHTML).toContain('<strong>48%</strong>');
    expect(article.querySelectorAll('li')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });
});
