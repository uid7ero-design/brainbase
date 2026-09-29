import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { getDeptConfig } from '@/lib/hlna/departmentConfigs';
import { HLNA_MODULES } from '@/lib/hlna/modules';

// G5 behaviour contracts — the /dashboard fallback overlays
// (components/panels/*) and the hlna fallback cards
// (components/hlna/{MorningBriefing,CommandSuggestions,RecommendedActions}).
//
// Every expected value below was derived from the BASE code at ecb5b03
// (`git show ecb5b03:<file>`), not from the current working tree:
//   - fetch URLs, methods, headers and exact JSON bodies (key order included);
//   - localStorage persistence of the address book ('brainbase:contacts');
//   - memoryManager calls; useNews.refresh; the brain-graph fetch;
//   - the Escape set: in base, Contacts (staged: editing -> detail -> close),
//     Inbox (staged: compose -> close), Integrations, Memory and BrainGraph
//     owned a window-level Escape handler; News and Activity did NOT. BrainBase
//     itself only closes the chat on Escape (pinned in
//     tests/containment/contractsG5.test.ts). useOverlayFocus must not add one.
//   - hlna cards: fireHelena(<same prompt>) + setChatOpen(true).
// The overlay-focus block (focus in / Tab trapped / focus returns to the
// opener) pins the behaviour this pass ADDED — base had none.
// Synthetic fixtures only; fetch is stubbed; the WebGL engine never starts.

type Store = Record<string, unknown>;
const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const ref: { state: Record<string, unknown> } = { state: {} };
  return {
    listeners,
    ref,
    set(patch: Record<string, unknown>) {
      ref.state = { ...ref.state, ...patch };
      listeners.forEach(l => l());
    },
  };
});

vi.mock('@/lib/state/useAppStore', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const subscribe = (l: () => void) => { h.listeners.add(l); return () => { h.listeners.delete(l); }; };
  return {
    useAppStore: (sel?: (s: Store) => unknown) => {
      const s = React.useSyncExternalStore(subscribe, () => h.ref.state);
      return sel ? sel(s) : s;
    },
  };
});
vi.mock('@/components/layout/LeftSidebar', () => ({ BrainWidget: () => <div>brain widget</div> }));
const mm = vi.hoisted(() => ({
  getLongTerm: vi.fn(() => [{ ts: 1, fact: 'Prefers morning briefings' }]),
  getShortTerm: vi.fn(() => [{ ts: 5, fact: 'Asked about Monday run' }]),
  getPreferences: vi.fn(() => ({ units: 'metric' })),
  getRecentHistory: vi.fn(() => [{ ts: 2, user: 'Status?', assistant: 'All clear.' }]),
  clearAll: vi.fn(), forgetLongTerm: vi.fn(), forgetShortTerm: vi.fn(),
  clearLongTerm: vi.fn(), clearShortTerm: vi.fn(), removePreference: vi.fn(), clearPreferences: vi.fn(),
}));
vi.mock('@/lib/memory/memoryManager', () => ({ memoryManager: mm }));
const news = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/hooks/useNews', () => ({
  useNews: () => ({
    articles: [
      { id: 'a1', title: 'Fixture tech story', url: 'https://example.test/a1', category: 'tech', source: 'Example', time: null },
      { id: 'a2', title: 'Fixture cyber story', url: 'https://example.test/a2', category: 'cyber', source: 'Example', time: null },
    ],
    loading: false, fetchedAt: null, refresh: news.refresh,
  }),
}));
vi.mock('three', () => ({}));
vi.mock('three/addons/controls/OrbitControls.js', () => ({ OrbitControls: class {} }));
vi.mock('three/addons/renderers/CSS2DRenderer.js', () => ({ CSS2DRenderer: class {}, CSS2DObject: class {} }));

const fireHelena = vi.fn();
const setChatOpen = vi.fn();
const OPEN_KEYS = ['integrationsOpen', 'inboxOpen', 'contactsOpen', 'memoryPanelOpen', 'newsOpen', 'brainGraphOpen'] as const;
type OpenKey = typeof OPEN_KEYS[number];
const SETTER: Record<OpenKey, string> = {
  integrationsOpen: 'setIntegrationsOpen', inboxOpen: 'setInboxOpen', contactsOpen: 'setContactsOpen',
  memoryPanelOpen: 'setMemoryPanelOpen', newsOpen: 'setNewsOpen', brainGraphOpen: 'setBrainGraphOpen',
};
const setters = Object.fromEntries(OPEN_KEYS.map(k => [k, vi.fn((v: boolean) => h.set({ [k]: v }))])) as Record<OpenKey, ReturnType<typeof vi.fn>>;

function resetStore(open: Partial<Record<OpenKey, boolean>> = {}) {
  h.ref.state = {
    ...Object.fromEntries(OPEN_KEYS.map(k => [k, false])),
    ...open,
    activeDepartment: 'waste', activeModule: null, lastUpload: null,
    fireHelena, setChatOpen,
    ...Object.fromEntries(OPEN_KEYS.map(k => [SETTER[k], setters[k]])),
  };
}

type FetchOverrides = Record<string, unknown>;
function stubFetch(over: FetchOverrides = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed mock signature
  const fn = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
    for (const [prefix, body] of Object.entries(over)) if (url.startsWith(prefix)) return json(body);
    if (url.startsWith('/api/integrations/gmail/status')) return json({ connected: true, email: 'ops@example.test' });
    if (url.startsWith('/api/integrations/gmail/messages')) return json({ messages: [
      { id: 'm1', from: 'Dana Ops <dana@example.test>', subject: 'Route change', snippet: 'Monday run', time: '09:10', unread: true },
    ] });
    if (url.startsWith('/api/integrations/gmail/message?')) return json({ id: 'm1', threadId: 't1', from: 'Dana Ops <dana@example.test>', subject: 'Route change', body: 'Fixture body', date: null });
    if (url.startsWith('/api/integrations/gmail/send')) return json({ ok: true });
    if (url.startsWith('/api/spotify/now-playing')) return json(null, false);
    if (url.startsWith('/api/brain/graph')) return new Promise<Response>(() => {});
    if (url.startsWith('/api/hlna/')) return json({}, false);
    return json({});
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const callsTo = (fn: ReturnType<typeof stubFetch>, url: string) => fn.mock.calls.filter(c => String(c[0]) === url);

const { ActivityPanel } = await import('@/components/panels/ActivityPanel');
const { IntegrationsPanel } = await import('@/components/panels/IntegrationsPanel');
const { InboxPanel } = await import('@/components/panels/InboxPanel');
const { ContactsPanel } = await import('@/components/panels/ContactsPanel');
const { MemoryPanel } = await import('@/components/panels/MemoryPanel');
const { NewsPanel } = await import('@/components/panels/NewsPanel');
const { BrainGraphPanel } = await import('@/components/panels/BrainGraphPanel');
const { MorningBriefing } = await import('@/components/hlna/MorningBriefing');
const { CommandSuggestions } = await import('@/components/hlna/CommandSuggestions');
const { RecommendedActions } = await import('@/components/hlna/RecommendedActions');
const Activity = ActivityPanel as unknown as ComponentType<Record<string, unknown>>;

const DANA = { id: 'c1', name: 'Dana Ops', emails: ['dana@example.test'], phones: ['+61 400 000 000'], socials: { website: 'example.test' } };
const storedContacts = () => localStorage.getItem('brainbase:contacts');

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  localStorage.setItem('brainbase:contacts', JSON.stringify([DANA]));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

function Opener({ openKey, children }: { openKey: OpenKey; children: ReactNode }) {
  return (
    <>
      <button type="button" onClick={() => h.set({ [openKey]: true })}>Open {openKey}</button>
      {children}
    </>
  );
}

// ── Fetch / persistence contracts (base ecb5b03) ─────────────────────────────

describe('InboxPanel — base fetch contract', () => {
  it('GETs status, messages and message?id=<id> with no init object', async () => {
    const fetchMock = stubFetch();
    resetStore({ inboxOpen: true });
    const { user } = renderBrainbase(<InboxPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Inbox' });
    const row = await within(dialog).findByRole('button', { name: /Dana Ops/ });
    await user.click(row);
    await within(dialog).findByText('Fixture body');
    for (const url of ['/api/integrations/gmail/status', '/api/integrations/gmail/messages', '/api/integrations/gmail/message?id=m1']) {
      const calls = callsTo(fetchMock, url);
      expect(calls.length, url).toBeGreaterThan(0);
      expect(calls[0].length, url).toBe(1);
    }
  });

  it('compose POSTs /api/integrations/gmail/send with {to, subject||"(no subject)", body}', async () => {
    const fetchMock = stubFetch();
    resetStore({ inboxOpen: true });
    const { user } = renderBrainbase(<InboxPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Inbox' });
    await within(dialog).findByRole('button', { name: /Dana Ops/ });
    await user.click(within(dialog).getByRole('button', { name: 'Compose' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'To' }), 'lee@example.test ');
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'Hello there');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(callsTo(fetchMock, '/api/integrations/gmail/send')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, '/api/integrations/gmail/send')[0];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.body).toBe(JSON.stringify({ to: 'lee@example.test', subject: '(no subject)', body: 'Hello there' }));
    expect(await within(dialog).findByText('Message sent')).toBeInTheDocument();
  });

  it('reply POSTs /api/integrations/gmail/send with {to, "Re: " subject, body, threadId, inReplyTo}', async () => {
    const fetchMock = stubFetch();
    resetStore({ inboxOpen: true });
    const { user } = renderBrainbase(<InboxPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Inbox' });
    await user.click(await within(dialog).findByRole('button', { name: /Dana Ops/ }));
    await within(dialog).findByText('Fixture body');
    await user.click(within(dialog).getByRole('button', { name: 'Reply' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Reply' }), 'Thanks');
    await user.click(within(dialog).getByRole('button', { name: 'Send Reply' }));
    await waitFor(() => expect(callsTo(fetchMock, '/api/integrations/gmail/send')).toHaveLength(1));
    const [, init] = callsTo(fetchMock, '/api/integrations/gmail/send')[0];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init?.body).toBe(JSON.stringify({
      to: 'dana@example.test', subject: 'Re: Route change', body: 'Thanks', threadId: 't1', inReplyTo: 'm1',
    }));
    expect(await within(dialog).findByText('Reply sent successfully.')).toBeInTheDocument();
  });

  it('the Contacts header button opens the address book (setContactsOpen(true))', async () => {
    stubFetch();
    resetStore({ inboxOpen: true });
    const { user } = renderBrainbase(<InboxPanel />);
    await user.click(within(screen.getByRole('dialog', { name: 'Inbox' })).getByRole('button', { name: 'Contacts' }));
    expect(setters.contactsOpen).toHaveBeenCalledWith(true);
  });
});

describe('IntegrationsPanel — base fetch contract', () => {
  it('GETs gmail status + messages and spotify now-playing with no init object', async () => {
    const fetchMock = stubFetch();
    resetStore({ integrationsOpen: true });
    renderBrainbase(<IntegrationsPanel />);
    await screen.findByText('Route change');
    for (const url of ['/api/integrations/gmail/status', '/api/integrations/gmail/messages', '/api/spotify/now-playing']) {
      const calls = callsTo(fetchMock, url);
      expect(calls.length, url).toBeGreaterThan(0);
      expect(calls[0].length, url).toBe(1);
    }
  });

  it('Disconnect sends DELETE /api/integrations/gmail/status and shows Not connected', async () => {
    const fetchMock = stubFetch();
    resetStore({ integrationsOpen: true });
    const { user } = renderBrainbase(<IntegrationsPanel />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/integrations/gmail/status', { method: 'DELETE' }));
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
  });

  it('Connect GETs /api/integrations/gmail/login and alerts the error (error path)', async () => {
    const fetchMock = stubFetch({
      '/api/integrations/gmail/status': { connected: false },
      '/api/integrations/gmail/login': { error: 'fixture oauth unavailable' },
    });
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    resetStore({ integrationsOpen: true });
    const { user } = renderBrainbase(<IntegrationsPanel />);
    await user.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('fixture oauth unavailable'));
    const calls = callsTo(fetchMock, '/api/integrations/gmail/login');
    expect(calls).toHaveLength(1);
    expect(calls[0].length).toBe(1);
  });

  it('Connect navigates window.location.href to the returned url (success path)', async () => {
    stubFetch({
      '/api/integrations/gmail/status': { connected: false },
      '/api/integrations/gmail/login': { url: '#gmail-oauth-fixture' },
    });
    resetStore({ integrationsOpen: true });
    const { user } = renderBrainbase(<IntegrationsPanel />);
    await user.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(window.location.hash).toBe('#gmail-oauth-fixture'));
    window.location.hash = '';
  });
});

describe('ContactsPanel — base localStorage CRUD contract (key brainbase:contacts)', () => {
  it('create: appends {id:"c_<Date.now()>", name, emails, phones, socials} in base key order', async () => {
    resetStore({ contactsOpen: true });
    const { user } = renderBrainbase(<ContactsPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Address Book' });
    await user.click(within(dialog).getByRole('button', { name: 'New Contact' }));
    await user.type(within(dialog).getByLabelText('NAME'), 'Alex Field');
    await user.type(within(dialog).getByRole('textbox', { name: 'Email address 1' }), 'alex@example.test');
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    await user.click(within(dialog).getByRole('button', { name: 'Save Contact' }));
    expect(storedContacts()).toBe(JSON.stringify([
      DANA,
      { id: 'c_1700000000000', name: 'Alex Field', emails: ['alex@example.test'], phones: [], socials: { twitter: '', linkedin: '', github: '', website: '' } },
    ]));
  });

  it('create: a blank name is not saved', async () => {
    resetStore({ contactsOpen: true });
    const { user } = renderBrainbase(<ContactsPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Address Book' });
    await user.click(within(dialog).getByRole('button', { name: 'New Contact' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save Contact' }));
    expect(storedContacts()).toBe(JSON.stringify([DANA]));
  });

  it('update: replaces the contact in place, socials merged over the blank set', async () => {
    resetStore({ contactsOpen: true });
    const { user } = renderBrainbase(<ContactsPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Address Book' });
    await user.click(await within(dialog).findByRole('button', { name: /Dana Ops/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Edit' }));
    await user.type(within(dialog).getByLabelText('NAME'), '-Smith');
    await user.click(within(dialog).getByRole('button', { name: 'Save Contact' }));
    expect(storedContacts()).toBe(JSON.stringify([
      { id: 'c1', name: 'Dana Ops-Smith', emails: ['dana@example.test'], phones: ['+61 400 000 000'], socials: { twitter: '', linkedin: '', github: '', website: 'example.test' } },
    ]));
  });

  it('delete: removes the contact immediately (no confirm step, as base)', async () => {
    resetStore({ contactsOpen: true });
    const { user } = renderBrainbase(<ContactsPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Address Book' });
    await user.click(await within(dialog).findByRole('button', { name: /Dana Ops/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(storedContacts()).toBe('[]');
    expect(within(dialog).getByText('Select a contact')).toBeInTheDocument();
  });

  it('clicking the scrim closes; clicking inside the dialog does not', async () => {
    resetStore({ contactsOpen: true });
    const { user } = renderBrainbase(<ContactsPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Address Book' });
    await user.click(dialog);
    expect(setters.contactsOpen).not.toHaveBeenCalled();
    await user.click(dialog.parentElement!);
    expect(setters.contactsOpen).toHaveBeenCalledWith(false);
  });
});

describe('MemoryPanel — base memoryManager contract', () => {
  it('reads history(20) and wires forget / clear / remove / clearAll to the same calls', async () => {
    resetStore({ memoryPanelOpen: true });
    const { user } = renderBrainbase(<MemoryPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Helena Memory' });
    expect(mm.getRecentHistory).toHaveBeenCalledWith(20);
    const forget = within(dialog).getAllByRole('button', { name: 'Forget this memory' });
    await user.click(forget[0]);
    expect(mm.forgetLongTerm).toHaveBeenCalledWith(1);
    await user.click(forget[1]);
    expect(mm.forgetShortTerm).toHaveBeenCalledWith(5);
    await user.click(within(dialog).getByRole('button', { name: /clear long-term/i }));
    expect(mm.clearLongTerm).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: /clear short-term/i }));
    expect(mm.clearShortTerm).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('tab', { name: 'Preferences' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove preference units' }));
    expect(mm.removePreference).toHaveBeenCalledWith('units');
    await user.click(within(dialog).getByRole('button', { name: /clear preferences/i }));
    expect(mm.clearPreferences).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'CLEAR ALL' }));
    expect(mm.clearAll).toHaveBeenCalledTimes(1);
  });
});

describe('NewsPanel / BrainGraphPanel — base data contract', () => {
  it('News: Refresh calls useNews().refresh; the panel itself fetches nothing', async () => {
    const fetchMock = stubFetch();
    resetStore({ newsOpen: true });
    const { user } = renderBrainbase(<NewsPanel />);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(news.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const link = screen.getByRole('link', { name: /Fixture tech story/ });
    expect(link).toHaveAttribute('href', 'https://example.test/a1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('BrainGraph: GET /api/brain/graph (no init) after open, again on Refresh', async () => {
    const fetchMock = stubFetch();
    resetStore({ brainGraphOpen: true });
    const { user } = renderBrainbase(<BrainGraphPanel />);
    await act(async () => { await new Promise(r => setTimeout(r, 120)); });
    expect(callsTo(fetchMock, '/api/brain/graph')).toHaveLength(1);
    expect(callsTo(fetchMock, '/api/brain/graph')[0].length).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(callsTo(fetchMock, '/api/brain/graph')).toHaveLength(2);
  });
});

// ── Escape ownership (base set) ──────────────────────────────────────────────

describe('Escape — the same panels own it as in base, with the same effect', () => {
  it('Integrations, Memory and BrainGraph close on Escape', async () => {
    stubFetch();
    for (const [key, ui] of [
      ['integrationsOpen', <IntegrationsPanel key="i" />],
      ['memoryPanelOpen', <MemoryPanel key="m" />],
      ['brainGraphOpen', <BrainGraphPanel key="b" />],
    ] as const) {
      resetStore({ [key]: true });
      const { user, unmount } = renderBrainbase(ui);
      await user.keyboard('{Escape}');
      expect(setters[key], key).toHaveBeenCalledWith(false);
      expect(screen.queryByRole('dialog')).toBeNull();
      unmount();
    }
  });

  it('News does NOT close on Escape (base had no handler) — only its ESC button closes it', async () => {
    resetStore({ newsOpen: true });
    const { user } = renderBrainbase(<NewsPanel />);
    await user.keyboard('{Escape}');
    expect(setters.newsOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'NEWS FEED' })).toBeInTheDocument();
  });

  it('Activity rail has no Escape behaviour', async () => {
    const onToggle = vi.fn();
    const { user } = renderBrainbase(<Activity items={[]} latestId={null} open onToggle={onToggle} />);
    await user.keyboard('{Escape}');
    expect(onToggle).not.toHaveBeenCalled();
    expect(setChatOpen).not.toHaveBeenCalled();
  });

  it('Inbox Escape is staged: compose -> list, then close', async () => {
    stubFetch();
    resetStore({ inboxOpen: true });
    const { user } = renderBrainbase(<InboxPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Inbox' });
    await within(dialog).findByRole('button', { name: /Dana Ops/ });
    await user.click(within(dialog).getByRole('button', { name: 'Compose' }));
    expect(within(dialog).getByRole('textbox', { name: 'To' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(dialog).queryByRole('textbox', { name: 'To' })).toBeNull();
    expect(setters.inboxOpen).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(setters.inboxOpen).toHaveBeenCalledWith(false);
  });

  it('Contacts Escape is staged: editing -> detail -> close', async () => {
    resetStore({ contactsOpen: true });
    const { user } = renderBrainbase(<ContactsPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Address Book' });
    await user.click(await within(dialog).findByRole('button', { name: /Dana Ops/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Edit' }));
    expect(within(dialog).getByLabelText('NAME')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(dialog).queryByLabelText('NAME')).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Dana Ops' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(dialog).getByText('Select a contact')).toBeInTheDocument();
    expect(setters.contactsOpen).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(setters.contactsOpen).toHaveBeenCalledWith(false);
  });
});

// ── Overlay focus (added by this pass) ───────────────────────────────────────

const FOCUS_CASES: { key: OpenKey; name: string | RegExp; close: string | RegExp; ui: ReactNode }[] = [
  { key: 'inboxOpen', name: 'Inbox', close: 'Close inbox', ui: <InboxPanel /> },
  { key: 'contactsOpen', name: 'Address Book', close: 'Close address book', ui: <ContactsPanel /> },
  { key: 'integrationsOpen', name: 'Integrations', close: 'Close integrations', ui: <IntegrationsPanel /> },
  { key: 'memoryPanelOpen', name: 'Helena Memory', close: 'Close Helena memory', ui: <MemoryPanel /> },
  { key: 'newsOpen', name: 'NEWS FEED', close: /ESC/, ui: <NewsPanel /> },
  { key: 'brainGraphOpen', name: 'BRAIN', close: 'Back to HLNA', ui: <BrainGraphPanel /> },
];

async function openViaOpener(key: OpenKey, name: string | RegExp, ui: ReactNode) {
  stubFetch();
  const r = renderBrainbase(<Opener openKey={key}>{ui}</Opener>);
  const opener = screen.getByRole('button', { name: `Open ${key}` });
  await r.user.click(opener);
  const dialog = screen.getByRole('dialog', { name });
  return { ...r, opener, dialog };
}
const settle = () => act(async () => { await new Promise(res => setTimeout(res, 120)); });

describe.each(FOCUS_CASES)('overlay focus — $name', ({ key, name, close, ui }) => {
  it('opening moves focus into the dialog', async () => {
    const { dialog } = await openViaOpener(key, name, ui);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('focus is still inside the dialog once async content has settled', async () => {
    const { dialog } = await openViaOpener(key, name, ui);
    await settle();
    // Regression pin for a review finding (fixed in useOverlayFocus): for
    // Integrations, initial focus used to land on GmailCard's transient
    // "Connect" button, which unmounts when the status fetch resolves and
    // dropped focus to <body>. Focus is now re-homed to the panel.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Tab / Shift+Tab stay trapped inside the dialog', async () => {
    const { user, dialog } = await openViaOpener(key, name, ui);
    await settle();
    const first = dialog.querySelector<HTMLElement>('button:not([disabled]), input, textarea, a[href]')!;
    act(() => first.focus());
    const count = dialog.querySelectorAll('button, input, textarea, a[href]').length;
    for (let i = 0; i < count + 2; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `tab ${i}`).toBe(true);
    }
    for (let i = 0; i < count + 2; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement), `shift+tab ${i}`).toBe(true);
    }
  });

  it('closing through the close control returns focus to the opener', async () => {
    const { user, dialog, opener } = await openViaOpener(key, name, ui);
    await settle();
    await user.click(within(dialog).getByRole('button', { name: close }));
    expect(setters[key]).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull());
    expect(opener).toHaveFocus();
  });
});

// ── hlna fallback cards + Activity rail handlers (base) ──────────────────────

describe('hlna fallback cards — same callbacks and prompts as base', () => {
  const waste = getDeptConfig('waste');

  it('MorningBriefing POSTs briefing + whatchanged and (demo path) wires the three CTAs to the base prompts', async () => {
    const fetchMock = stubFetch();
    const { user } = renderBrainbase(<MorningBriefing />);
    await screen.findByRole('heading', { name: 'HLNΛ · Operations Briefing' });
    expect(fetchMock).toHaveBeenCalledWith('/api/hlna/briefing', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledWith('/api/hlna/whatchanged', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const b = waste.briefing;
    await user.click(screen.getByRole('button', { name: 'Full Briefing' }));
    expect(fireHelena).toHaveBeenLastCalledWith(`${b.changed} ${b.why} ${b.action}` + ' Give me a complete executive briefing with all key metrics, risks, and the top 3 actions I should take today.');
    await user.click(screen.getByRole('button', { name: 'What changed?' }));
    expect(fireHelena).toHaveBeenLastCalledWith('What exactly changed in our waste operations data since last week? Give me a precise comparison of all KPIs.');
    const a0 = waste.alerts[0];
    const thirdLabel = a0 ? a0.label.split('—')[0].trim().split(' ').slice(0, 4).join(' ') : 'Top alert';
    await user.click(screen.getByRole('button', { name: thirdLabel }));
    expect(fireHelena).toHaveBeenLastCalledWith(a0?.command ?? 'What are the top risk items for this department right now?');
    expect(setChatOpen).toHaveBeenCalledTimes(3);
    expect(setChatOpen.mock.calls.every(c => c[0] === true)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Refresh briefing' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });

  it('MorningBriefing (real-data path) derives sections and the Full Briefing prompt as base', async () => {
    stubFetch({
      '/api/hlna/briefing': { greeting: 'Morning', lines: ['L1', 'L2', 'L3'], urgentCount: 1, summary: 'Sum', hasData: true, timestamp: new Date().toISOString() },
    });
    const { user } = renderBrainbase(<MorningBriefing />);
    await screen.findByRole('heading', { name: 'HLNΛ · Operations Briefing' });
    // whatchanged falls through to `ok:false` -> the `hasReal` branch.
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('L2 L3')).toBeInTheDocument();
    expect(screen.getByText('1 urgent item flagged. L3')).toBeInTheDocument();
    expect(screen.getByText('Sum')).toBeInTheDocument();
    expect(screen.queryByText('DEMO')).toBeNull();
    expect(screen.getByText('1 URGENT')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Full Briefing' }));
    expect(fireHelena).toHaveBeenCalledWith('Morning. Sum Give me a complete executive briefing with all key metrics, risks, and the top 3 actions I should take today.');
  });

  it('CommandSuggestions: department commands (max 6 / panel 4 + overflow), chip -> fireHelena(command) + setChatOpen(true)', async () => {
    const chips = waste.commands;
    const { user, unmount } = renderBrainbase(<CommandSuggestions />);
    let buttons = within(screen.getByRole('group', { name: 'Command suggestions' })).getAllByRole('button');
    expect(buttons).toHaveLength(Math.min(6, chips.length));
    await user.click(buttons[buttons.length - 1]);
    expect(fireHelena).toHaveBeenLastCalledWith(chips[buttons.length - 1].command);
    expect(setChatOpen).toHaveBeenLastCalledWith(true);
    unmount();

    renderBrainbase(<CommandSuggestions panelMode />);
    buttons = within(screen.getByRole('group', { name: 'Command suggestions' })).getAllByRole('button');
    expect(buttons).toHaveLength(Math.min(4, chips.length));
    if (chips.length > 4) expect(screen.getByText(`+${chips.length - 4}`, { exact: false })).toBeInTheDocument();
    await user.click(buttons[0]);
    expect(fireHelena).toHaveBeenLastCalledWith(chips[0].command);
  });

  it('CommandSuggestions: a non-waste active module uses its questions as the commands', async () => {
    const mod = Object.values(HLNA_MODULES).find(m => m.key !== 'waste_recycling')!;
    h.set({ activeModule: mod.key });
    const { user } = renderBrainbase(<CommandSuggestions />);
    const buttons = within(screen.getByRole('group', { name: 'Command suggestions' })).getAllByRole('button');
    expect(buttons).toHaveLength(Math.min(6, mod.questions.length));
    await user.click(buttons[0]);
    expect(fireHelena).toHaveBeenCalledWith(mod.questions[0]);
  });

  it('RecommendedActions: one card per department action, card -> fireHelena(action.command) + setChatOpen(true)', async () => {
    const { user } = renderBrainbase(<RecommendedActions />);
    const list = screen.getByRole('heading', { name: 'Recommended Actions' }).parentElement!.nextElementSibling as HTMLElement;
    const cards = within(list).getAllByRole('button');
    expect(cards).toHaveLength(waste.actions.length);
    for (let i = 0; i < cards.length; i++) {
      await user.click(cards[i]);
      expect(fireHelena).toHaveBeenLastCalledWith(waste.actions[i].command);
    }
    expect(setChatOpen).toHaveBeenCalledTimes(cards.length);
  });

  it('ActivityPanel: toggle -> onToggle; each alert -> fireHelena(alert.command) + setChatOpen(true); Approve/Dismiss stay inert', async () => {
    const onToggle = vi.fn();
    const items = [{ id: 'i1', type: 'reply', title: 'Reply drafted', time: '2m' }];
    const { user } = renderBrainbase(<Activity items={items} latestId="i1" open onToggle={onToggle} />);
    const rail = screen.getByRole('complementary', { name: 'Activity' });
    await user.click(within(rail).getByRole('button', { name: 'Collapse activity panel' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    const alertButtons = within(rail).getAllByRole('button').filter(b => b.textContent?.includes('severity'));
    expect(alertButtons).toHaveLength(waste.alerts.length);
    for (let i = 0; i < alertButtons.length; i++) {
      await user.click(alertButtons[i]);
      expect(fireHelena).toHaveBeenLastCalledWith(waste.alerts[i].command);
    }
    const before = fireHelena.mock.calls.length;
    const approve = within(rail).queryByRole('button', { name: 'Approve' });
    if (approve) {
      await user.click(approve);
      await user.click(within(rail).getByRole('button', { name: 'Dismiss' }));
    }
    expect(fireHelena.mock.calls.length).toBe(before);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ── Review follow-ups (focus robustness + Memory tabs keyboard model) ────────

describe('MemoryPanel tabs keyboard model and safe initial focus', () => {
  it('initial focus is the selected tab, never the destructive "Clear" control', async () => {
    const { dialog } = await openViaOpener('memoryPanelOpen', 'Helena Memory', <MemoryPanel />);
    const active = document.activeElement as HTMLElement;
    expect(dialog.contains(active)).toBe(true);
    expect(active.getAttribute('role')).toBe('tab');
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.textContent).toBe('Memory');
  });

  it('arrows / Home / End move selection with a roving tabindex', async () => {
    const { user, dialog } = await openViaOpener('memoryPanelOpen', 'Helena Memory', <MemoryPanel />);
    const tabs = () => within(dialog).getAllByRole('tab');
    expect(tabs().map(t => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toBe('Preferences');
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs().map(t => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('History');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toBe('Memory');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.textContent).toBe('History');
    await user.keyboard('{Home}');
    expect(document.activeElement?.textContent).toBe('Memory');
    expect(mm.clearLongTerm).not.toHaveBeenCalled();
  });
});

describe('useOverlayFocus re-homes focus when the focused control unmounts', () => {
  it('Tab from <body> while an overlay is open is pulled back inside', async () => {
    const { user, dialog } = await openViaOpener('integrationsOpen', 'Integrations', <IntegrationsPanel />);
    await settle();
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    expect(document.activeElement).toBe(document.body);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
