import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// G3 behaviour contracts for the remaining-visual-islands pass:
//   /briefings, /data, /portal, /reports, /reports/[id].
// Every expected value below (URL, method, headers, JSON body, FormData
// field, route, generated-content output) is DERIVED FROM THE BASE SOURCE
// (commit ecb5b03), not from the current code. Where the base had no such
// behaviour (the /data report dialog closing on Escape / scrim) the test
// pins the documented intentional change and says so.
// All network is a vi.fn() fetch mock returning synthetic fixtures.

const h = vi.hoisted(() => ({
  push: vi.fn(),
  setLastUpload: vi.fn(),
  sqlCalls: [] as Array<{ strings: string[]; values: unknown[] }>,
  reportRows: [] as Record<string, unknown>[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed mock signature
  generateReportHTML: vi.fn((_args: unknown) => '<html><body>SYNTHETIC EXPORT</body></html>'),
  pdfOps: [] as Array<[string, ...unknown[]]>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('@/lib/state/useAppStore', () => ({
  useAppStore: (sel: (s: { setLastUpload: typeof h.setLastUpload }) => unknown) => sel({ setLastUpload: h.setLastUpload }),
}));
vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ organisationId: 'org-test', role: 'admin' })),
}));
vi.mock('@/lib/db', () => ({
  default: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    h.sqlCalls.push({ strings: [...strings], values });
    return h.reportRows;
  }),
}));
vi.mock('@/lib/evidence-report', () => ({ generateReportHTML: h.generateReportHTML }));
vi.mock('jspdf', () => {
  class FakePDF {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    constructor(opts: unknown) { h.pdfOps.push(['new', opts]); }
    setFont(...a: unknown[]) { h.pdfOps.push(['setFont', ...a]); }
    setFontSize(...a: unknown[]) { h.pdfOps.push(['setFontSize', ...a]); }
    setTextColor(...a: unknown[]) { h.pdfOps.push(['setTextColor', ...a]); }
    setDrawColor(...a: unknown[]) { h.pdfOps.push(['setDrawColor', ...a]); }
    line(...a: unknown[]) { h.pdfOps.push(['line', ...a]); }
    splitTextToSize(t: string) { return [t]; }
    text(...a: unknown[]) { h.pdfOps.push(['text', ...a]); }
    addPage() { h.pdfOps.push(['addPage']); }
    save(...a: unknown[]) { h.pdfOps.push(['save', ...a]); }
  }
  return { jsPDF: FakePDF, default: FakePDF };
});

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
/** Calls whose init carries a method (i.e. every write). */
const writes = () =>
  fetchMock.mock.calls.filter(c => (c[1] as RequestInit | undefined)?.method !== undefined) as Array<[string, RequestInit]>;
const jsonBody = (init: RequestInit) => JSON.parse(String(init.body));

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
  h.push.mockReset();
  h.setLastUpload.mockReset();
  h.generateReportHTML.mockClear();
  h.sqlCalls.length = 0;
  h.pdfOps.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString();

// ── /briefings ──────────────────────────────────────────────────────────

const EVIDENCE = {
  sourceDataset: ['waste_records'], sourceColumns: ['suburb'], evidenceSummary: 'Twelve suburbs.',
  calculationUsed: 'avg(x)', confidenceReason: 'Full month.', sampleRows: [{ suburb: 'Northside' }],
};
const BRIEFINGS = [
  { id: 'b1', title: 'Weekly contamination summary', briefing_type: 'insight', agent_name: 'InsightAgent', response_text: 'Down 2 points.', evidence_json: EVIDENCE, created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'b2', title: 'Follow-up actions', briefing_type: 'action', agent_name: null, response_text: null, evidence_json: null, created_at: iso(10) },
];

describe('G3 contract — /briefings (base ecb5b03)', () => {
  it('load: GET /api/briefings with no init; each filter re-fetches /api/briefings?type=<key>', async () => {
    mockFetch(() => ({ briefings: BRIEFINGS }));
    const { user } = renderBrainbase(<BriefingsClient />);
    await screen.findByText('Weekly contamination summary');
    expect(fetchMock.mock.calls[0]).toEqual(['/api/briefings']);
    for (const [label, key] of [['Briefing', 'briefing'], ['Insight', 'insight'], ['Action', 'action'], ['Chat', 'chat']] as const) {
      await user.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(`/api/briefings?type=${key}`));
    }
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/briefings'));
    expect(writes()).toEqual([]);
  });

  it('delete: exactly DELETE /api/briefings?id=<id>, no confirm prompt (as base), card removed', async () => {
    mockFetch(() => ({ briefings: BRIEFINGS }));
    const { user } = renderBrainbase(<BriefingsClient />);
    await user.click(await screen.findByRole('button', { name: /Weekly contamination summary/ }));
    await user.click(screen.getByRole('button', { name: /Delete/ }));
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(writes()).toEqual([['/api/briefings?id=b1', { method: 'DELETE' }]]);
    await waitFor(() => expect(screen.queryByText('Weekly contamination summary')).not.toBeInTheDocument());
  });

  it('export: generateReportHTML gets the base argument object; the HTML is written to window.open("", "_blank")', async () => {
    mockFetch(() => ({ briefings: BRIEFINGS }));
    const doc = { write: vi.fn(), close: vi.fn() };
    const openSpy = vi.fn(() => ({ document: doc }));
    vi.stubGlobal('open', openSpy);
    const { user } = renderBrainbase(<BriefingsClient />);
    await user.click(await screen.findByRole('button', { name: /Weekly contamination summary/ }));
    await user.click(screen.getByRole('button', { name: /Export report/ }));
    expect(h.generateReportHTML).toHaveBeenCalledTimes(1);
    expect(h.generateReportHTML).toHaveBeenCalledWith({
      content: 'Down 2 points.', agentName: 'InsightAgent', routeType: 'insight', confidence: null,
      evidence: EVIDENCE, orgName: null, timestamp: '2026-09-01T00:00:00.000Z',
    });
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(doc.write).toHaveBeenCalledWith('<html><body>SYNTHETIC EXPORT</body></html>');
    expect(doc.close).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
  });
});

// ── /data ───────────────────────────────────────────────────────────────

const FILES = [
  { id: 'f1', file_name: 'collections-2026.xlsx', file_type: 'xlsx', upload_status: 'complete', created_at: iso(60), uploaded_by_name: 'Test User', record_count: 1200 },
  { id: 'f2', file_name: 'pending.csv', file_type: 'csv', upload_status: 'processing', created_at: iso(10), uploaded_by_name: 'Test User', record_count: 0 },
];
const dataRoutes: Route = (url, init) => {
  if (url === '/api/files' && !init) return { files: FILES };
  if (url === '/api/files/upload') return { fileName: 'new.csv', recordsInserted: 7 };
  if (url === '/api/reports') return { report: { report_title: 'Synthetic report' } };
  if (url.startsWith('/api/files/')) return init?.method === 'DELETE' ? { ok: true } : { records: [] };
  return {};
};

async function openReportDialog(user: ReturnType<typeof renderBrainbase>['user']) {
  await screen.findByText('collections-2026.xlsx');
  const trigger = screen.getByRole('button', { name: 'Generate Report' });
  await user.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: 'Generate Report' }) };
}

describe('G3 contract — /data (base ecb5b03)', () => {
  it('report generation (defaults): POST /api/reports, JSON header, body { reportType: "waste_summary" } only', async () => {
    mockFetch(dataRoutes);
    const { user } = renderBrainbase(<DataClient canDelete />);
    const { dialog } = await openReportDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Generate with HLNA' }));
    expect(writes()).toEqual([['/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportType: 'waste_summary' }),
    }]]);
    expect(await within(dialog).findByText('Report "Synthetic report" generated.')).toBeInTheDocument();
    // Base: the modal closes itself 1500ms after success.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it('report generation (custom + source file): body carries sourceFileId and customPrompt exactly as base', async () => {
    mockFetch(dataRoutes);
    const { user } = renderBrainbase(<DataClient canDelete />);
    const { dialog } = await openReportDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Report Type'), 'custom');
    await user.selectOptions(within(dialog).getByLabelText(/Source File/), 'f1');
    await user.type(within(dialog).getByLabelText('Custom Prompt'), 'Focus on Northside');
    // Only complete files are offered as sources (base filter).
    expect(within(within(dialog).getByLabelText(/Source File/)).getAllByRole('option').map(o => o.getAttribute('value'))).toEqual(['', 'f1']);
    await user.click(within(dialog).getByRole('button', { name: 'Generate with HLNA' }));
    const [[url, init]] = writes();
    expect(url).toBe('/api/reports');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify({ reportType: 'custom', sourceFileId: 'f1', customPrompt: 'Focus on Northside' }));
  });

  it('report types offered are exactly the base REPORT_TYPES, in order', async () => {
    mockFetch(dataRoutes);
    const { user } = renderBrainbase(<DataClient canDelete />);
    const { dialog } = await openReportDialog(user);
    const opts = within(within(dialog).getByLabelText('Report Type')).getAllByRole('option');
    expect(opts.map(o => [o.getAttribute('value'), o.textContent])).toEqual([
      ['waste_summary', 'Waste Summary'], ['contamination', 'Contamination Analysis'], ['cost_analysis', 'Cost Analysis'],
      ['diversion_rate', 'Diversion Rate'], ['custom', 'Custom'],
    ]);
  });

  it('delete: base confirm text, then DELETE /api/files/<id> and a reload of /api/files', async () => {
    mockFetch(dataRoutes);
    const { user } = renderBrainbase(<DataClient canDelete />);
    await user.click(await screen.findByRole('button', { name: 'Delete collections-2026.xlsx' }));
    expect(globalThis.confirm).toHaveBeenCalledWith('Delete this file and all its waste records?');
    expect(writes()).toEqual([['/api/files/f1', { method: 'DELETE' }]]);
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/files')).toHaveLength(2));
  });

  it('upload (file picker): POST /api/files/upload with FormData whose only field is "file"', async () => {
    mockFetch(dataRoutes);
    const { container } = renderBrainbase(<DataClient canDelete />);
    await screen.findByText('collections-2026.xlsx');
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.getAttribute('accept')).toBe('.xlsx,.xls,.csv');
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /Drag & drop or click to upload/ }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const file = new File(['a,b\n1,2'], 'new.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText('Uploaded "new.csv" — 7 records inserted.');
    const [[url, init]] = writes();
    expect(url).toBe('/api/files/upload');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    const fd = init.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect([...fd.keys()]).toEqual(['file']);
    expect((fd.get('file') as File).name).toBe('new.csv');
    expect(h.setLastUpload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchMock.mock.calls.filter(c => c[0] === '/api/files')).toHaveLength(2));
  });

  it('upload (drop): the dropped file goes through the same POST /api/files/upload', async () => {
    mockFetch(dataRoutes);
    renderBrainbase(<DataClient canDelete />);
    await screen.findByText('collections-2026.xlsx');
    const file = new File(['x'], 'dropped.xlsx');
    fireEvent.drop(screen.getByRole('button', { name: /Drag & drop or click to upload/ }), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [[url, init]] = writes();
    expect(url).toBe('/api/files/upload');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBe(file);
  });

  it('session expired: POST /api/auth/logout then router.push("/login")', async () => {
    mockFetch((url, init) => (url === '/api/files' && !init ? json({}, 401) : {}));
    const { user } = renderBrainbase(<DataClient canDelete={false} />);
    await user.click(await screen.findByRole('button', { name: 'Log out and back in' }));
    expect(writes()).toEqual([['/api/auth/logout', { method: 'POST' }]]);
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/login'));
  });

  // Base: the modal had only a "×" close button; Escape and the backdrop did
  // nothing. Escape + scrim closing is a DOCUMENTED INTENTIONAL change
  // (shared Dialog close model). None of the three paths sends a request.
  it('dialog close: explicit close button, Escape and scrim all close it and return focus to the trigger', async () => {
    mockFetch(dataRoutes);
    const { user } = renderBrainbase(<DataClient canDelete />);

    let { trigger, dialog } = await openReportDialog(user);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Close Generate Report' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);

    ({ trigger, dialog } = await openReportDialog(user));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);

    ({ trigger, dialog } = await openReportDialog(user));
    const scrim = dialog.previousElementSibling as HTMLElement;
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(scrim);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);

    expect(writes()).toEqual([]);
  });
});

// ── /portal ─────────────────────────────────────────────────────────────

const REQUESTS = [
  {
    id: 'q1', type: 'request', title: 'Add a squad roster export', description: 'CSV please.',
    status: 'awaiting_client', priority: 'normal', created_at: iso(2000),
    booking: { id: 'bk1', date: '2026-10-02', time: '10:00', session_type: 'Onboarding', status: 'pending_confirmation', confirmed_at: null },
  },
];
const portalRoutes: Route = (url, init) => {
  if (url === '/api/portal/pipeline' && !init) return { requests: REQUESTS };
  if (url === '/api/portal/pipeline' && init?.method === 'POST') {
    return { request: { id: 'q9', type: 'issue', title: 'Broken', description: 'Detail', status: 'new', priority: 'normal', created_at: iso(0), booking: null } };
  }
  if (url === '/api/portal/pipeline/q1/messages' && !init) return { messages: [] };
  if (url === '/api/portal/pipeline/q1/messages') return { message: { id: 'm9', author_type: 'client', body: 'hello there', created_at: iso(0) } };
  if (url.startsWith('/api/bookings/')) return { ok: true };
  return {};
};
async function openFirst(user: ReturnType<typeof renderBrainbase>['user']) {
  await user.click(await screen.findByRole('button', { name: /Add a squad roster export/ }));
  await screen.findByText('No messages yet.');
}

describe('G3 contract — /portal (base ecb5b03)', () => {
  it('load + open: GET /api/portal/pipeline, then GET /api/portal/pipeline/<id>/messages (no init)', async () => {
    mockFetch(portalRoutes);
    const { user } = renderBrainbase(<PortalPage />);
    await openFirst(user);
    expect(fetchMock.mock.calls.map(c => c.slice(0, c[1] === undefined ? 1 : 2))).toEqual([
      ['/api/portal/pipeline'], ['/api/portal/pipeline/q1/messages'],
    ]);
  });

  it('reply: POST /api/portal/pipeline/<id>/messages, JSON header, body { body: <trimmed text> }', async () => {
    mockFetch(portalRoutes);
    const { user } = renderBrainbase(<PortalPage />);
    await openFirst(user);
    await user.type(screen.getByPlaceholderText('Add a message…'), '  hello there  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(writes()).toEqual([['/api/portal/pipeline/q1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'hello there' }),
    }]]);
    expect(await screen.findByText('hello there')).toBeInTheDocument();
  });

  it('submit request: POST /api/portal/pipeline, JSON header, body { type, title, description } (untrimmed, base key order)', async () => {
    mockFetch(portalRoutes);
    const { user } = renderBrainbase(<PortalPage />);
    await screen.findByRole('button', { name: /Add a squad roster export/ });
    await user.click(screen.getByRole('button', { name: '+ New request' }));
    await user.click(screen.getByRole('button', { name: /Bug \/ issue/ }));
    await user.type(screen.getByPlaceholderText('Short title *'), 'Broken ');
    await user.type(screen.getByPlaceholderText('More detail (optional)…'), 'Detail');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(writes()).toEqual([['/api/portal/pipeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'issue', title: 'Broken ', description: 'Detail' }),
    }]]);
    expect(await screen.findByRole('button', { name: /Broken/ })).toBeInTheDocument();
  });

  it('submit request: the three base type values are sent as-is', async () => {
    for (const [label, value] of [[/Feature request/, 'request'], [/Bug \/ issue/, 'issue'], [/Feedback/, 'feedback']] as const) {
      mockFetch(portalRoutes);
      const { user, unmount } = renderBrainbase(<PortalPage />);
      await screen.findByRole('button', { name: /Add a squad roster export/ });
      await user.click(screen.getByRole('button', { name: '+ New request' }));
      await user.click(screen.getByRole('button', { name: label }));
      await user.type(screen.getByPlaceholderText('Short title *'), 'T');
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      expect(jsonBody(writes()[0][1]).type).toBe(value);
      unmount();
    }
  });

  it('confirm booking: PATCH /api/bookings/<bookingId>, JSON header, body { action: "confirm" }; request becomes Resolved', async () => {
    mockFetch(portalRoutes);
    const { user } = renderBrainbase(<PortalPage />);
    await openFirst(user);
    await user.click(screen.getByRole('button', { name: 'Confirm Session' }));
    expect(writes()).toEqual([['/api/bookings/bk1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }),
    }]]);
    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText(/^✅ Session confirmed for .+ at 10:00$/)).toBeInTheDocument();
  });

  it('request change: PATCH /api/bookings/<bookingId>, body { action: "reschedule", message }', async () => {
    mockFetch(portalRoutes);
    const { user } = renderBrainbase(<PortalPage />);
    await openFirst(user);
    await user.click(screen.getByRole('button', { name: 'Request Change' }));
    await user.type(screen.getByPlaceholderText('What time works for you? (optional)…'), 'Thursday pm');
    await user.click(screen.getByRole('button', { name: 'Confirm Request' }));
    expect(writes()).toEqual([['/api/bookings/bk1', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reschedule', message: 'Thursday pm' }),
    }]]);
    expect(await screen.findByText('🔁 Awaiting new time')).toBeInTheDocument();
  });
});

// ── /reports + /reports/[id] ────────────────────────────────────────────

// VERBATIM copy of renderMarkdown from `git show ecb5b03:app/reports/[id]/ReportView.tsx`.
function baseRenderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // fenced code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // horizontal rule
    .replace(/^---$/gm, '<hr />')
    // bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bullet lists — group consecutive lines
    .replace(/((?:^- .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    })
    // numbered lists
    .replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `<ol>${items}</ol>`;
    })
    // paragraphs
    .split(/\n{2,}/)
    .map(chunk => {
      const t = chunk.trim();
      if (!t) return '';
      if (/^<(h[1-4]|ul|ol|pre|hr)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');
}

const SYNTHETIC_REPORT = [
  '# Synthetic Council waste report',
  '',
  '## Summary',
  '',
  'Diversion rose to **48%** and ***record*** organics; see *appendix* and `tonnes_total`.',
  'Second line of the same paragraph & <b>not bold</b>.',
  '',
  '### Breakdown',
  '',
  '- Organics up',
  '- Recycling flat',
  '- Landfill **down**',
  '',
  '1. Audit bins',
  '2. Educate residents',
  '',
  '---',
  '',
  '#### Method',
  '',
  '```sql',
  'SELECT avg(x) FROM t WHERE a < 3 && b > 1;',
  '```',
  '',
  'Closing note.',
].join('\n');

const VIEW_PROPS = {
  id: 'r1', title: 'Q3 diversion', reportType: 'diversion_rate', content: SYNTHETIC_REPORT,
  createdByName: 'Test User', organisationName: 'Synthetic Council', sourceFileName: 'collections-2026.xlsx',
  createdAt: '2026-09-01T00:00:00.000Z', canDelete: true,
};

describe('G3 contract — /reports/[id] (base ecb5b03)', () => {
  it('generated body: the rendered HTML equals the base renderMarkdown output for a synthetic report', () => {
    renderBrainbase(<ReportView {...VIEW_PROPS} />);
    const article = screen.getByRole('article', { name: 'Q3 diversion' });
    const expected = document.createElement('div');
    expected.innerHTML = baseRenderMarkdown(SYNTHETIC_REPORT);
    expect(article.innerHTML).toBe(expected.innerHTML);
    // Sanity: the synthetic report exercises every base rule.
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'hr', 'pre', 'code', 'strong', 'em', 'ul', 'ol', 'br', 'p']) {
      expect(article.querySelector(tag), tag).not.toBeNull();
    }
    expect(article.querySelector('b')).toBeNull(); // raw HTML is escaped, as base
    expect(article.classList.contains('report-content')).toBe(true);
  });

  it('PDF export: GET /api/reports/<id>?format=pdf, base jsPDF layout, saved as <slug>.pdf', async () => {
    const pdf = {
      title: 'Q3 diversion', organisationName: 'Synthetic Council', reportType: 'diversion_rate',
      createdAt: '2026-09-01T00:00:00.000Z', createdBy: 'Test User', sourceFile: 'collections-2026.xlsx',
      content: '## Summary\n**Bold** and *it* and `code`\n- item\n1. first\n---\n```\nskip\n```',
    };
    mockFetch(url => (url === '/api/reports/r1?format=pdf' ? { pdf } : {}));
    const { user } = renderBrainbase(<ReportView {...VIEW_PROPS} />);
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(h.pdfOps.some(o => o[0] === 'save')).toBe(true));
    expect(fetchMock.mock.calls).toEqual([['/api/reports/r1?format=pdf']]);

    // Base plain-text transform + layout, recomputed here from the base source.
    const plain = pdf.content
      .replace(/```[\s\S]*?```/g, '').replace(/^#{1,4} /gm, '').replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/^- /gm, '• ')
      .replace(/^\d+\. /gm, '').replace(/^---$/gm, '').split('\n');
    const texts = h.pdfOps.filter(o => o[0] === 'text').map(o => o.slice(1));
    const margin = 18;
    const date = new Date(pdf.createdAt).toLocaleDateString('en-AU');
    const expectedTexts: unknown[][] = [
      [['Q3 diversion'], margin, 18],
      [`Synthetic Council · Diversion Rate · ${date} · Test User`, margin, 30],
      ['Source: collections-2026.xlsx', margin, 35],
    ];
    let y = 35 + 10 + 8;
    for (const line of plain) {
      expectedTexts.push([[line || ' '], margin, y]);
      y += 5.5 + (line.trim() === '' ? 2 : 0);
    }
    expect(texts).toEqual(expectedTexts);
    expect(h.pdfOps[0]).toEqual(['new', { unit: 'mm', format: 'a4' }]);
    expect(h.pdfOps.find(o => o[0] === 'line')).toEqual(['line', margin, 45, 210 - margin, 45]);
    expect(h.pdfOps.filter(o => o[0] === 'save')).toEqual([['save', 'q3_diversion.pdf']]);
  });

  it('delete: base confirm text, DELETE /api/reports/<id>, then router.push("/reports")', async () => {
    mockFetch(() => ({ ok: true }));
    const { user } = renderBrainbase(<ReportView {...VIEW_PROPS} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(globalThis.confirm).toHaveBeenCalledWith('Delete this report? This cannot be undone.');
    expect(writes()).toEqual([['/api/reports/r1', { method: 'DELETE' }]]);
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/reports'));
  });

  it('delete control is gated by canDelete', () => {
    renderBrainbase(<ReportView {...VIEW_PROPS} canDelete={false} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Reports' })).toHaveAttribute('href', '/reports');
  });
});

describe('G3 contract — /reports list (base ecb5b03)', () => {
  it('runs the base org-scoped query and links every row to /reports/<id>', async () => {
    h.reportRows = [
      { id: 'r1', report_type: 'diversion_rate', report_title: 'Q3 diversion', created_at: iso(60), created_by_name: 'Test User', source_file_name: 'a.xlsx' },
      { id: 'r2', report_type: 'mystery', report_title: 'Ad hoc', created_at: iso(30), created_by_name: 'Test User', source_file_name: null },
    ];
    renderBrainbase(await ReportsPage());
    expect(h.sqlCalls).toHaveLength(1);
    expect(h.sqlCalls[0].strings.join('${}')).toBe(`
    SELECT
      r.id, r.report_type, r.report_title, r.created_at,
      u.name  AS created_by_name,
      uf.file_name AS source_file_name
    FROM reports r
    JOIN users u ON u.id = r.created_by
    LEFT JOIN uploaded_files uf ON uf.id = r.source_file_id
    WHERE r.organisation_id = \${}
    ORDER BY r.created_at DESC
  `);
    expect(h.sqlCalls[0].values).toEqual(['org-test']);
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/reports/r1', '/reports/r1', '/reports/r2', '/reports/r2']);
    expect(screen.getByText('Diversion Rate')).toBeInTheDocument();
    expect(screen.getByText('mystery')).toBeInTheDocument();
    expect(screen.getByText('All data')).toBeInTheDocument();
  });

  it('empty list links to /data with the base copy', async () => {
    h.reportRows = [];
    renderBrainbase(await ReportsPage());
    expect(screen.getByText('No reports yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload data and generate your first report →' })).toHaveAttribute('href', '/data');
  });
});
