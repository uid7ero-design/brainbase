import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase D3 — Organiser rendered for real (jsdom) with fixture data behind a
// stubbed fetch. Asserts the keyboard / accessibility contract D3 added:
// real buttons for every click target, named controls, dialog semantics,
// Escape handling and focus return. Workflow logic is not re-tested here
// (the organiser* containment tests pin it).

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/organiser',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: OrganiserPage } = await import('@/app/organiser/page');

const BOARDS = [
  { id: 'b1', name: 'Work', color: '#60A5FA', icon: null, position: 0, item_count: 2 },
  { id: 'b2', name: 'Home', color: null, icon: null, position: 1, item_count: 0 },
];
const now = '2026-09-20T10:00:00.000Z';
const item = (id: string, name: string, status: string, priority: string | null, due: string | null) => ({
  id, group_id: 'g1', parent_item_id: null, name, status, priority, owner: null, due_date: due, notes: null,
  fields: {}, custom_values: {}, assignee_user_id: null, position: 0, created_at: now, updated_at: now,
});
const BOARD_DATA = {
  board: BOARDS[0],
  groups: [{ id: 'g1', name: 'This week', color: '#22C55E', position: 0 }],
  items: [item('i1', 'Draft budget', 'Working on it', 'High', '2026-09-28'), item('i2', 'Book venue', 'Done', null, null)],
  columns: [{ id: 'c1', name: 'Stage', type: 'status', options: [{ label: 'Plan', color: '#60A5FA' }], position: 0 }],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url === '/api/organiser/boards') return json({ boards: BOARDS });
    if (url.startsWith('/api/organiser/boards/b1')) return json(BOARD_DATA);
    if (url.startsWith('/api/organiser/boards/b2')) return json({ board: BOARDS[1], groups: [], items: [], columns: [] });
    if (url.startsWith('/api/organiser/members')) return json({ members: [{ id: 'u1', name: 'Sam Lee' }] });
    if (url.includes('/files')) return json({ files: [] });
    if (url.includes('/updates')) return json({ updates: [] });
    if (url.startsWith('/api/organiser/activity')) return json({ activity: [], next_cursor: null });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', vi.fn(() => false));
  vi.stubGlobal('prompt', vi.fn(() => null));
});

async function renderOrganiser(theme: 'light' | 'dark' = 'dark') {
  localStorage.setItem('bb-theme', theme);
  const utils = renderBrainbase(<ThemeProvider><OrganiserPage /></ThemeProvider>, { theme });
  await screen.findByRole('button', { name: 'Draft budget' });
  return utils;
}

describe('Organiser rail', () => {
  it('boards are real buttons; the current board is marked with aria-current and selection works from the keyboard', async () => {
    const { user } = await renderOrganiser();
    const nav = screen.getByRole('navigation', { name: 'Organiser boards' });
    const work = within(nav).getByRole('button', { name: /^Work/ });
    const home = within(nav).getByRole('button', { name: /^Home/ });
    expect(work).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current');
    home.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(home).toHaveAttribute('aria-current', 'page'));
    expect(fetchMock).toHaveBeenCalledWith('/api/organiser/boards/b2', expect.anything());
  });

  it('board options: menu button reports expanded state; Escape closes and returns focus', async () => {
    const { user } = await renderOrganiser();
    const options = screen.getByRole('button', { name: 'Board options for Work' });
    expect(options).toHaveAttribute('aria-expanded', 'false');
    await user.click(options);
    expect(options).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Work options' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(options).toHaveFocus();
  });
});

describe('Organiser table view', () => {
  it('toolbar: board title is an edit button, views are pressed toggles, actions are named', async () => {
    const { user } = await renderOrganiser();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Work');
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '+ New group' })).toBeInTheDocument();
    const title = within(screen.getByRole('heading', { level: 1 })).getByRole('button', { name: /^Work ?\(edit\)$/ });
    title.focus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Edit Work' });
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Edit Work' })).toBeNull();
  });

  it('row actions are keyboard reachable (always in the DOM) and every control is named', async () => {
    await renderOrganiser();
    expect(screen.getByRole('button', { name: 'Rename Draft budget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Draft budget' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status for Draft budget' })).toHaveValue('Working on it');
    expect(screen.getByRole('combobox', { name: 'Priority for Draft budget' })).toHaveValue('High');
    expect(screen.getByLabelText('Due date for Draft budget')).toHaveValue('2026-09-28');
    expect(screen.getByRole('textbox', { name: 'Add item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse This week' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Column options for Stage' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('item drawer: opens from the name button as a labelled dialog, focuses inside, Escape closes and returns focus', async () => {
    const { user } = await renderOrganiser();
    const name = screen.getByRole('button', { name: 'Draft budget' });
    name.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Item details: Draft budget' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('combobox', { name: 'Status' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Assignee' })).toHaveAttribute('aria-haspopup', 'listbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(name).toHaveFocus();
  });

  it('Escape inside the drawer title editor cancels the edit without closing the drawer', async () => {
    const { user } = await renderOrganiser();
    await user.click(screen.getByRole('button', { name: 'Draft budget' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^Draft budget ?\(edit\)$/ }));
    expect(within(dialog).getByRole('textbox', { name: 'Edit Draft budget' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Edit Draft budget' })).toBeNull();
  });

  it('column options editor is a dialog with Escape', async () => {
    const { user } = await renderOrganiser();
    await user.click(screen.getByRole('button', { name: 'Column options for Stage' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit options' }));
    const dialog = screen.getByRole('dialog', { name: '“Stage” options' });
    expect(within(dialog).getByRole('textbox', { name: 'Option 1 label' })).toHaveFocus();
    expect(within(dialog).getAllByRole('button', { name: /^Colour / })[1]).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['light', 'dark'] as const)('table view has no axe violations (%s)', async theme => {
    const { container } = await renderOrganiser(theme);
    await expectNoAxeViolations(container);
  });

  it.each(['light', 'dark'] as const)('open drawer has no axe violations (%s)', async theme => {
    const { user } = await renderOrganiser(theme);
    await user.click(screen.getByRole('button', { name: 'Draft budget' }));
    await screen.findByRole('dialog');
    await expectNoAxeViolations(document.body);
  });
});

describe('Organiser board and calendar views', () => {
  it('kanban: status columns are labelled regions; card titles are buttons; status select is named', async () => {
    const { user } = await renderOrganiser();
    await user.click(screen.getByRole('button', { name: 'Board' }));
    const working = screen.getByRole('region', { name: 'Working on it, 1 item' });
    expect(within(working).getByRole('button', { name: 'Draft budget' })).toBeInTheDocument();
    expect(within(working).getByRole('combobox', { name: 'Status for Draft budget' })).toBeInTheDocument();
    expect(within(working).getByText('High')).toBeInTheDocument();
  });

  it('calendar: month navigation is named; due items are buttons that announce their status', async () => {
    const { user } = await renderOrganiser();
    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    // The fixture item is due 2026-09-28; move to that month if the clock differs.
    for (let i = 0; i < 24 && !screen.queryByRole('heading', { name: /September 2026/ }); i++) {
      const target = new Date() < new Date('2026-09-01') ? 'Next month' : 'Previous month';
      await user.click(screen.getByRole('button', { name: target }));
    }
    expect(screen.getByRole('button', { name: /^Draft budget, ?Working on it$/ })).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('board view has no axe violations (%s)', async theme => {
    const { user, container } = await renderOrganiser(theme);
    await user.click(screen.getByRole('button', { name: 'Board' }));
    await expectNoAxeViolations(container);
  });
});
