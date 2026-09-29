import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within, cleanup } from '@testing-library/react';
import { renderBrainbase, type BrainbaseTheme } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Remaining visual islands pass (Phase 6A/6B) — the /dashboard fallback's
// panels (components/panels/*, components/hlna/{MorningBriefing,
// CommandSuggestions,RecommendedActions}) and the BrainGraphPanel chrome,
// rendered for real (jsdom) in light and dark. Asserts the accessibility
// contract the pass added (dialog semantics, named icon-only controls,
// pressed / expanded / current state, labelled fields, real buttons) and
// that axe finds nothing. Synthetic fixtures only; fetch is stubbed and
// the WebGL graph engine is never started (the graph fetch never settles).

const store: Record<string, unknown> = {};
const fireHelena = vi.fn();
const setChatOpen = vi.fn();
const setOpen = {
  integrationsOpen: vi.fn(), inboxOpen: vi.fn(), contactsOpen: vi.fn(),
  memoryPanelOpen: vi.fn(), newsOpen: vi.fn(), brainGraphOpen: vi.fn(),
};
function resetStore() {
  Object.assign(store, {
    integrationsOpen: true, inboxOpen: true, contactsOpen: true,
    memoryPanelOpen: true, newsOpen: true, brainGraphOpen: true,
    activeDepartment: 'waste', activeModule: null, lastUpload: null,
    fireHelena, setChatOpen,
    setIntegrationsOpen: setOpen.integrationsOpen, setInboxOpen: setOpen.inboxOpen,
    setContactsOpen: setOpen.contactsOpen, setMemoryPanelOpen: setOpen.memoryPanelOpen,
    setNewsOpen: setOpen.newsOpen, setBrainGraphOpen: setOpen.brainGraphOpen,
  });
}
resetStore();

vi.mock('@/lib/state/useAppStore', () => ({
  useAppStore: (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(store) : store),
}));
vi.mock('@/components/layout/LeftSidebar', () => ({ BrainWidget: () => <div>brain widget</div> }));
vi.mock('@/lib/memory/memoryManager', () => ({
  memoryManager: {
    getLongTerm: () => [{ ts: 1, fact: 'Prefers morning briefings' }],
    getShortTerm: () => [],
    getPreferences: () => ({ units: 'metric' }),
    getRecentHistory: () => [{ ts: 2, user: 'Status?', assistant: 'All clear.' }],
    clearAll: vi.fn(), forgetLongTerm: vi.fn(), forgetShortTerm: vi.fn(),
    clearLongTerm: vi.fn(), clearShortTerm: vi.fn(), removePreference: vi.fn(), clearPreferences: vi.fn(),
  },
}));
vi.mock('@/hooks/useNews', () => ({
  useNews: () => ({
    articles: [
      { id: 'a1', title: 'Fixture tech story', url: 'https://example.test/a1', category: 'tech', source: 'Example', time: null, points: 12, comments: 3 },
      { id: 'a2', title: 'Fixture cyber story', url: 'https://example.test/a2', category: 'cyber', source: 'Example', time: null },
    ],
    loading: false, fetchedAt: null, refresh: vi.fn(),
  }),
}));
// The THREE engine is never started here (the graph fetch never settles) —
// stub the modules so jsdom never touches WebGL.
vi.mock('three', () => ({}));
vi.mock('three/addons/controls/OrbitControls.js', () => ({ OrbitControls: class {} }));
vi.mock('three/addons/renderers/CSS2DRenderer.js', () => ({ CSS2DRenderer: class {}, CSS2DObject: class {} }));

function stubFetch() {
  const fn = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    if (url.startsWith('/api/integrations/gmail/status')) return json({ connected: true, email: 'ops@example.test' });
    if (url.startsWith('/api/integrations/gmail/messages')) return json({ messages: [
      { id: 'm1', from: 'Dana Ops <dana@example.test>', subject: 'Route change', snippet: 'Monday run', time: '09:10', unread: true },
      { id: 'm2', from: 'Lee <lee@example.test>', subject: 'Invoice', snippet: '', time: '08:00', unread: false },
    ] });
    if (url.startsWith('/api/integrations/gmail/message?')) return json({ id: 'm1', threadId: 't1', from: 'Dana Ops <dana@example.test>', subject: 'Route change', body: 'Fixture body', date: null });
    if (url.startsWith('/api/spotify/now-playing')) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) } as Response);
    if (url.startsWith('/api/brain/graph')) return new Promise<Response>(() => {});
    if (url.startsWith('/api/hlna/')) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    return json({});
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const { ActivityPanel } = await import('@/components/panels/ActivityPanel');
const { IntegrationsPanel } = await import('@/components/panels/IntegrationsPanel');
const { InboxPanel } = await import('@/components/panels/InboxPanel');
const { ContactsPanel } = await import('@/components/panels/ContactsPanel');
const { MemoryPanel } = await import('@/components/panels/MemoryPanel');
const { NewsPanel } = await import('@/components/panels/NewsPanel');
const { BrainGraphPanel, InlineBrainGraph } = await import('@/components/panels/BrainGraphPanel');
const { MorningBriefing } = await import('@/components/hlna/MorningBriefing');
const { CommandSuggestions } = await import('@/components/hlna/CommandSuggestions');
const { RecommendedActions } = await import('@/components/hlna/RecommendedActions');
const Activity = ActivityPanel as unknown as ComponentType<Record<string, unknown>>;

const ITEMS = [
  { id: 'i1', type: 'reply', title: 'Reply drafted', sub: 'To Dana', time: '2m' },
  { id: 'i2', type: 'queue', title: 'Queue cleared', time: '5m' },
];

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  stubFetch();
  localStorage.setItem('brainbase:contacts', JSON.stringify([
    { id: 'c1', name: 'Dana Ops', emails: ['dana@example.test'], phones: ['+61 400 000 000'], socials: { website: 'example.test' } },
  ]));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe.each<BrainbaseTheme>(['light', 'dark'])('/dashboard fallback panels — %s theme', (theme) => {
  it('ActivityPanel: named collapse toggle, alert buttons fire Helena, no axe violations', async () => {
    const onToggle = vi.fn();
    const { user, container } = renderBrainbase(<Activity items={ITEMS} latestId="i1" open onToggle={onToggle} />, { theme });
    const rail = screen.getByRole('complementary', { name: 'Activity' });
    const toggle = within(rail).getByRole('button', { name: 'Collapse activity panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(within(rail).getByRole('heading', { name: 'Live System Pulse' })).toBeInTheDocument();
    const alertButtons = within(rail).getAllByRole('button').filter(b => b.textContent?.includes('severity'));
    expect(alertButtons.length).toBeGreaterThan(0);
    await user.click(alertButtons[0]);
    expect(fireHelena).toHaveBeenCalledTimes(1);
    expect(setChatOpen).toHaveBeenCalledWith(true);
    expect(within(rail).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('ActivityPanel collapsed: toggle says expand', () => {
    renderBrainbase(<Activity items={ITEMS} latestId={null} open={false} onToggle={() => {}} />, { theme });
    expect(screen.getByRole('button', { name: 'Expand activity panel' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('IntegrationsPanel: labelled dialog, named close, gmail state, no axe violations', async () => {
    const { user, container } = renderBrainbase(<IntegrationsPanel />, { theme });
    const dialog = screen.getByRole('dialog', { name: 'Integrations' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(await within(dialog).findByText('ops@example.test')).toBeInTheDocument();
    expect(await within(dialog).findByText('Route change')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close integrations' }));
    expect(setOpen.integrationsOpen).toHaveBeenCalledWith(false);
    await expectNoAxeViolations(container);
  });

  it('InboxPanel: dialog, pressed compose toggle, aria-current message, same fetch URLs, no axe violations', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { user, container } = renderBrainbase(<InboxPanel />, { theme });
    const dialog = screen.getByRole('dialog', { name: 'Inbox' });
    const row = await within(dialog).findByRole('button', { name: /Dana Ops/ });
    await user.click(row);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/integrations/gmail/message?id=m1'));
    await waitFor(() => expect(row).toHaveAttribute('aria-current', 'true'));
    expect(await within(dialog).findByText('Fixture body')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    const compose = within(dialog).getByRole('button', { name: 'Compose' });
    expect(compose).toHaveAttribute('aria-pressed', 'false');
    await user.click(compose);
    expect(compose).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'To' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Subject' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close inbox' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('ContactsPanel: dialog, labelled search + form fields, current contact, no axe violations', async () => {
    const { user, container } = renderBrainbase(<ContactsPanel />, { theme });
    const dialog = screen.getByRole('dialog', { name: 'Address Book' });
    expect(within(dialog).getByRole('textbox', { name: 'Search contacts' })).toBeInTheDocument();
    const row = await within(dialog).findByRole('button', { name: /Dana Ops/ });
    await user.click(row);
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByRole('heading', { name: 'Dana Ops' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy Website' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await user.click(within(dialog).getByRole('button', { name: 'Edit' }));
    expect(within(dialog).getByLabelText('NAME')).toHaveValue('Dana Ops');
    expect(within(dialog).getByRole('textbox', { name: 'Email address 1' })).toHaveValue('dana@example.test');
    expect(within(dialog).getByRole('group', { name: 'SOCIALS' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('MemoryPanel: dialog with a real tablist, named forget/close controls, no axe violations', async () => {
    const { user, container } = renderBrainbase(<MemoryPanel />, { theme });
    const dialog = screen.getByRole('dialog', { name: 'Helena Memory' });
    const memoryTab = within(dialog).getByRole('tab', { name: 'Memory' });
    expect(memoryTab).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('button', { name: 'Forget this memory' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close Helena memory' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await user.click(within(dialog).getByRole('tab', { name: 'Preferences' }));
    expect(within(dialog).getByRole('tabpanel')).toHaveAccessibleName('Preferences');
    expect(within(dialog).getByRole('button', { name: 'Remove preference units' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('NewsPanel: dialog, pressed category filters, no axe violations', async () => {
    const { user, container } = renderBrainbase(<NewsPanel />, { theme });
    const dialog = screen.getByRole('dialog', { name: 'NEWS FEED' });
    const all = within(dialog).getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Cyber' }));
    expect(within(dialog).getByRole('button', { name: 'Cyber' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).queryByText('Fixture tech story')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /ESC/ }));
    expect(setOpen.newsOpen).toHaveBeenCalledWith(false);
    await expectNoAxeViolations(container);
  });

  it('BrainGraphPanel chrome: labelled dialog, themed controls, dark canvas well, no axe violations', async () => {
    const { user, container } = renderBrainbase(<BrainGraphPanel />, { theme });
    const dialog = screen.getByRole('dialog', { name: 'BRAIN' });
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/brain/graph');
    expect(within(dialog).getByText('DRAG TO ROTATE · SCROLL TO ZOOM · CLICK A NODE')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Back to HLNA' }));
    expect(setOpen.brainGraphOpen).toHaveBeenCalledWith(false);
    await expectNoAxeViolations(container);
  });

  it('InlineBrainGraph: loading state is announced, no axe violations', async () => {
    const { container } = renderBrainbase(<InlineBrainGraph />, { theme });
    expect(screen.getByRole('status')).toHaveTextContent('Loading brain graph…');
    await expectNoAxeViolations(container);
  });

  it('MorningBriefing (demo fallback), CommandSuggestions and RecommendedActions: real buttons, no axe violations', async () => {
    const { user, container } = renderBrainbase(
      <div>
        <MorningBriefing />
        <CommandSuggestions />
        <CommandSuggestions panelMode />
        <RecommendedActions />
      </div>,
      { theme },
    );
    expect(await screen.findByRole('heading', { name: 'HLNΛ · Operations Briefing' })).toBeInTheDocument();
    expect(screen.getByText('DEMO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh briefing' })).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Command suggestions' })).toHaveLength(2);
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Full Briefing' }));
    expect(fireHelena).toHaveBeenCalledTimes(1);
    expect(setChatOpen).toHaveBeenCalledWith(true);

    const actionsHeading = screen.getByRole('heading', { name: 'Recommended Actions' });
    const actionButtons = within(actionsHeading.parentElement!.nextElementSibling as HTMLElement).getAllByRole('button');
    expect(actionButtons.length).toBeGreaterThan(0);
    await user.click(actionButtons[0]);
    expect(fireHelena).toHaveBeenCalledTimes(2);
    expect(actionButtons[0]).toHaveAttribute('data-selected', 'true');
  });
});
